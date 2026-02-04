#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { loadEnv } from '../lib/env.mjs';
import { ClaudeClient as ClaudeClientReal } from '../lib/anthropic_client.mjs';
import { buildSystemPromptWedge } from '../policies/system_prompt_wedge.mjs';
import { parseClaudeXmlResponse, extractXmlTag } from '../lib/xml_parse.mjs';
import { getToolSchemasV2 } from '../tools/registry_v2.mjs';
import { makeLogger } from '../lib/logger.mjs';

function nowIso() {
  return new Date().toISOString();
}

function scanTerms({ inputText, text, mode }) {
  const input = String(inputText || '');
  const out = String(text || '');
  const lower = out.toLowerCase();
  const inputLower = input.toLowerCase();

  // Universal bans (fail anywhere: customer + agent)
  const universal = ['fraud', 'flagged', 'suspicious'];

  // Customer-facing-only bans (fail in customer_response; warn-only in agent_report)
  const customerOnly = [
    'straddle',
    'straddle portal',
    'pending_resolution',
    'unresolved',
    'tier 1',
    'tier 2',
    'admin portal',
    'per our policy',
    "i'm an ai",
    'i am an ai',
    "i'm a bot",
    'i am a bot',
    'as an ai',
  ];

  // Conditionally banned in customer-facing text unless user used the term.
  // In agent_report, these are allowed.
  const conditionalCustomer = [
    { term: 'plaid', allowedIfInputIncludes: 'plaid' },
    { term: 'ach', allowedIfInputIncludes: 'ach' },
  ];

  const hits = [];

  for (const t of universal) {
    if (lower.includes(t)) hits.push({ term: t, severity: 'fail', rule: 'universal' });
  }

  if (mode === 'customer') {
    for (const t of customerOnly) {
      if (lower.includes(t)) hits.push({ term: t, severity: 'fail', rule: 'customer_only' });
    }
    for (const { term, allowedIfInputIncludes } of conditionalCustomer) {
      if (lower.includes(term) && !inputLower.includes(allowedIfInputIncludes)) {
        hits.push({ term, severity: 'fail', rule: 'customer_only_conditional' });
      }
    }
  } else if (mode === 'agent') {
    for (const t of customerOnly) {
      if (lower.includes(t)) hits.push({ term: t, severity: 'warn', rule: 'customer_only' });
    }
    // plaid/ach are allowed in agent mode.
  }

  return hits;
}

function hasAllXmlTags(text) {
  const tags = ['customer_response', 'agent_report', 'escalate'];
  for (const t of tags) {
    if (extractXmlTag(text, t) == null) return false;
  }
  return true;
}

function formatRow(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i], ' ')).join('  ');
}

async function runOne({ scenario, client, tools }) {
  const system = buildSystemPromptWedge();
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            `<context>`,
            JSON.stringify({
              ticketMetadata: { channel: 'qa', scenarioId: scenario.id },
              customerData: {},
              note: 'QA harness',
            }, null, 2),
            `</context>`,
            `<customer_message>`,
            scenario.message,
            `</customer_message>`,
          ].join('\n'),
        },
      ],
    },
  ];

  const toolCallsSeen = [];
  const executeTool = async (name, input) => {
    toolCallsSeen.push({ tool: name, input, ts: nowIso() });
    const canned = scenario.mockTools?.[name];
    if (canned != null) return canned;
    return { ok: false, error: 'qa_no_mock_for_tool', tool: name };
  };

  const resp = await client.generateWithTools({ system, messages, tools, executeTool });

  const rawText = (resp.blocks || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const parsed = parseClaudeXmlResponse(rawText);

  // Validations
  const failures = [];

  // Structural
  if (!hasAllXmlTags(rawText)) failures.push('missing_xml_tags');

  // Routing
  if (parsed.escalate !== Boolean(scenario.expectedEscalate)) {
    failures.push(`routing_mismatch expected=${scenario.expectedEscalate} got=${parsed.escalate}`);
  }

  // Banned terms (customer response)
  const customerHits = scanTerms({ inputText: scenario.message, text: parsed.customer_response, mode: 'customer' });
  const customerFails = customerHits.filter(h => h.severity === 'fail');
  if (customerFails.length) failures.push(`banned_terms_customer:${customerFails.map(h => h.term).join(',')}`);

  // Banned terms (agent report): universal = fail; customer-only = warn
  const agentHits = scanTerms({ inputText: scenario.message, text: parsed.agent_report, mode: 'agent' });
  const agentFails = agentHits.filter(h => h.severity === 'fail');
  const agentWarns = agentHits.filter(h => h.severity === 'warn');
  if (agentFails.length) failures.push(`banned_terms_agent:${agentFails.map(h => h.term).join(',')}`);
  if (agentWarns.length) failures.push(`warn_agent_terms:${agentWarns.map(h => h.term).join(',')}`);

  // Tool expectations
  if (Array.isArray(scenario.requireTools) && scenario.requireTools.length) {
    for (const t of scenario.requireTools) {
      const seen = toolCallsSeen.some((x) => x.tool === t) || (resp.toolCalls || []).some((x) => x.tool === t);
      if (!seen) failures.push(`missing_tool_call:${t}`);
    }
  }

  // Clarification behavior
  if (scenario.expectClarification) {
    if (parsed.escalate !== false) failures.push('clarification_should_not_escalate');

    const cr = (parsed.customer_response || '').toLowerCase();
    const hasQuestionMark = parsed.customer_response.includes('?');
    const hasClarifyPhrase = ['could you', 'can you', 'would you', 'please share', 'let me know'].some(p => cr.includes(p));
    if (!(hasQuestionMark || hasClarifyPhrase)) failures.push('clarification_missing_question');

    if (toolCallsSeen.length) failures.push('clarification_should_not_call_tools');
  }

  return {
    id: scenario.id,
    title: scenario.title,
    expectedEscalate: Boolean(scenario.expectedEscalate),
    actualEscalate: parsed.escalate,
    toolCalls: toolCallsSeen.map((t) => t.tool),
    pass: failures.length === 0,
    failures,
  };
}

async function main() {
  const env = loadEnv();
  const log = makeLogger({ level: env.LOG_LEVEL });

  if (env.USE_STUBS) {
    throw new Error('QA requires USE_STUBS=false (real Claude behavior).');
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('QA requires ANTHROPIC_API_KEY');
  }

  const scenariosPath = path.join(process.cwd(), 'src', 'qa', 'scenarios.json');
  const scenarios = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));

  const client = new ClaudeClientReal({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, logger: log });
  const tools = getToolSchemasV2();

  const results = [];
  for (const scenario of scenarios) {
    // eslint-disable-next-line no-await-in-loop
    const r = await runOne({ scenario, client, tools });
    results.push(r);
  }

  const widths = [4, 5, 8, 8, 5, 60];
  console.log(formatRow(['#', 'ID', 'EXP_ESC', 'ACT_ESC', 'PASS', 'NOTES'], widths));
  console.log(formatRow(['-', '--', '-------', '-------', '----', '-----'], widths));

  let passCount = 0;
  results.forEach((r, idx) => {
    if (r.pass) passCount++;
    const notes = r.pass ? '' : r.failures.join('; ').slice(0, 300);
    console.log(formatRow([idx + 1, r.id, r.expectedEscalate, r.actualEscalate, r.pass ? 'Y' : 'N', notes], widths));
  });

  const failCount = results.length - passCount;
  console.log(`\nTotal: ${results.length}  Pass: ${passCount}  Fail: ${failCount}`);

  // Write JSON artifact
  const outPath = path.join(process.cwd(), 'tmp', `qa-results-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2));
  console.log(`Results JSON: ${outPath}`);

  process.exit(failCount ? 2 : 0);
}

main().catch((e) => {
  console.error('QA_RUN_FAILED:', e?.message || e);
  process.exit(1);
});

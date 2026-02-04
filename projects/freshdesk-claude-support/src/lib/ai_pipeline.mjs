import { buildSystemPromptV2 } from '../policies/system_prompt_v2.mjs';
import { parseClaudeXmlResponse } from './xml_parse.mjs';

export async function runAiTurn({ env, claudeClient, toolSchemas, executeTool, internalMessage, context }) {
  const system = buildSystemPromptV2();

  const messages = buildMessages({
    conversationHistory: context.conversationHistory,
    messageText: internalMessage.messageText || '',
    customerData: context.customerData,
    ticketMetadata: context.ticketMetadata,
  });

  const resp = await claudeClient.generateWithTools({
    system,
    messages,
    tools: toolSchemas,
    executeTool,
  });

  const rawText = blocksToText(resp.blocks || []);
  const parsed = parseClaudeXmlResponse(rawText);

  return {
    ...parsed,
    toolCalls: resp.toolCalls || [],
    forcedEscalate: resp.forcedEscalate || false,
  };
}

function buildMessages({ conversationHistory = [], messageText, customerData, ticketMetadata }) {
  const msgs = [];

  // Prior turns (best-effort)
  for (const h of conversationHistory || []) {
    msgs.push({
      role: h.incoming ? 'user' : 'assistant',
      content: [{ type: 'text', text: String(h.body_text || '') }],
    });
  }

  const contextBlock = {
    customerData: customerData || {},
    ticketMetadata: ticketMetadata || {},
  };

  const enriched = [
    `<context>`,
    JSON.stringify(contextBlock, null, 2),
    `</context>`,
    `<customer_message>`,
    messageText,
    `</customer_message>`,
  ].join('\n');

  msgs.push({ role: 'user', content: [{ type: 'text', text: enriched }] });
  return msgs.slice(-30);
}

function blocksToText(blocks) {
  return blocks
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim();
}

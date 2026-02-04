import express from 'express';
import pinoHttp from 'pino-http';

import { loadEnv } from './lib/env.mjs';
import { makeLogger } from './lib/logger.mjs';
import { FreshdeskClient } from './lib/freshdesk.mjs';
import { verifyFreshdeskWebhook } from './lib/verify_webhook.mjs';
import { freshdeskWebhookSchema, extractTicketId, extractCustomerMessage } from './lib/schemas.mjs';
import { buildTicketContext } from './lib/context.mjs';
import { makeRag } from './rag/provider.mjs';
import { getToolSchemas } from './tools/registry.mjs';
import { ToolDispatcher } from './tools/dispatcher.mjs';
import { makeAdminPortal } from './lib/admin_portal_stub.mjs';
import { ClaudeClient } from './lib/anthropic_stub.mjs';
import { Orchestrator } from './lib/orchestrator.mjs';

const env = loadEnv();
const log = makeLogger({ level: env.LOG_LEVEL });

const app = express();
app.use(pinoHttp({ logger: log }));

// Capture raw body for future signature verification.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

const freshdesk = new FreshdeskClient({ domain: env.FRESHDESK_DOMAIN, apiKey: env.FRESHDESK_API_KEY, logger: log });
const rag = makeRag({ env, logger: log });
const adminPortal = makeAdminPortal({ env, logger: log });
const tools = getToolSchemas({ refundApprovalThresholdUsd: env.REFUND_APPROVAL_THRESHOLD_USD });
const dispatcher = new ToolDispatcher({ env, freshdesk, rag, adminPortal, logger: log });
const claude = new ClaudeClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, logger: log, maxToolCallsPerTurn: env.MAX_TOOL_CALLS_PER_TURN });
const orchestrator = new Orchestrator({ env, freshdesk, claude, tools, dispatcher, rag, logger: log });

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'freshdesk-claude-support', time: new Date().toISOString() });
});

app.post('/webhooks/freshdesk', async (req, res) => {
  const auth = verifyFreshdeskWebhook({ req, rawBody: req.rawBody, secret: env.FRESHDESK_WEBHOOK_SECRET, logger: req.log });
  if (!auth.ok) return res.status(401).json({ ok: false, error: 'unauthorized', reason: auth.reason });

  const parsed = freshdeskWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, 'bad webhook payload');
    return res.status(400).json({ ok: false, error: 'bad_payload' });
  }

  const ticketId = extractTicketId(parsed.data);
  if (!ticketId) {
    req.log.info({ keys: Object.keys(parsed.data || {}) }, 'webhook missing ticket id (ignored)');
    return res.status(202).json({ ok: true, ignored: true });
  }

  // Acknowledge quickly; do work async (avoid webhook timeouts).
  res.status(202).json({ ok: true });

  try {
    const customerMessageText = extractCustomerMessage(parsed.data) || '(no message body in webhook; using ticket description)';
    const ticketContext = await buildTicketContext({ freshdesk, ticketId });

    const out = await orchestrator.handleTicketMessage({ ticketContext, customerMessageText });

    // If we escalate: add private note and optionally do not reply publicly.
    if (out.escalate) {
      await freshdesk.addPrivateNote(ticketId, {
        body: `🤖 AI suggested escalation (${out.escalationReason || 'unknown'})\n\nDraft reply:\n${out.replyText}`,
      });
      return;
    }

    // Normal: post reply.
    await freshdesk.replyToTicket(ticketId, { body: out.replyText });

    req.log.info({ event: 'ticket_replied', ticketId, model: out.model }, 'posted AI reply');
  } catch (e) {
    req.log.error({ err: { message: e?.message, status: e?.status, data: e?.data } }, 'webhook processing failed');
    try {
      await freshdesk.addPrivateNote(ticketId, {
        body: `🤖 AI middleware error while processing webhook.\n\nError: ${String(e?.message || e)}`,
      });
    } catch {
      // ignore
    }
  }
});

app.listen(env.PORT, () => {
  log.info({ port: env.PORT }, 'freshdesk-claude-support listening');
});

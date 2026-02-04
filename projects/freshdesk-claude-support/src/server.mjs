import express from 'express';
import pinoHttp from 'pino-http';

import { loadEnv } from './lib/env.mjs';
import { makeLogger } from './lib/logger.mjs';
import { FreshdeskClient } from './lib/freshdesk.mjs';
import { FreshchatClient } from './lib/freshchat.mjs';
import { verifyFreshdeskWebhook } from './lib/verify_webhook.mjs';
import { freshdeskWebhookSchema, extractTicketId } from './lib/schemas.mjs';
import { normalizeFreshdeskWebhook, normalizeFreshchatWebhook } from './lib/normalizer.mjs';
import { buildContext } from './lib/context_engine.mjs';
import { makeApiQueue, withRetryAfter } from './lib/queue.mjs';
import { ClaudeClient as ClaudeClientReal } from './lib/anthropic_client.mjs';
import { ClaudeClientStub } from './lib/anthropic_stub.mjs';
import { getToolSchemasV2 } from './tools/registry_v2.mjs';
import { makeToolExecutor } from './tools/dispatcher_v2.mjs';
import { runAiTurn } from './lib/ai_pipeline.mjs';
import { respondToTicket } from './handlers/freshdesk_responder.mjs';
import { respondToChat } from './handlers/freshchat_responder.mjs';

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

const queue = makeApiQueue({ concurrency: 10 });

const freshdesk = new FreshdeskClient({ domain: env.FRESHDESK_DOMAIN, apiKey: env.FRESHDESK_API_KEY, logger: log });
const freshchat = (env.FRESHCHAT_API_URL && env.FRESHCHAT_API_KEY)
  ? new FreshchatClient({ apiUrl: env.FRESHCHAT_API_URL, apiKey: env.FRESHCHAT_API_KEY, logger: log })
  : null;

const claude = (!env.USE_STUBS && env.ANTHROPIC_API_KEY)
  ? new ClaudeClientReal({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, logger: log })
  : new ClaudeClientStub({ model: env.ANTHROPIC_MODEL, logger: log });

const toolSchemas = getToolSchemasV2();
const executeTool = makeToolExecutor({ env, logger: log });

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

  const internalMessage = normalizeFreshdeskWebhook(parsed.data);

  // Process async
  (async () => {
    try {
      if (env.USE_STUBS && !env.FRESHDESK_API_KEY) {
        req.log.info({ ticketId }, 'stub mode: no freshdesk key; skipping API writes');
        return;
      }

      const context = await withRetryAfter(queue, () => buildContext({ env, freshdesk, freshchat, internalMessage }), { logger: req.log });
      const aiResult = await runAiTurn({ env, claudeClient: claude, toolSchemas, executeTool, internalMessage, context });

      if (env.USE_STUBS && !env.FRESHDESK_API_KEY) return;

      await withRetryAfter(queue, () => respondToTicket({ freshdesk, ticketId, aiResult }), { logger: req.log });
      req.log.info({ event: 'freshdesk_done', ticketId, escalate: aiResult.escalate }, 'handled freshdesk webhook');
    } catch (e) {
      req.log.error({ err: { message: e?.message, status: e?.status, data: e?.data } }, 'freshdesk webhook processing failed');
      try {
        if (env.FRESHDESK_API_KEY) {
          await freshdesk.addPrivateNote(ticketId, {
            body: `🤖 AI middleware error while processing webhook.\n\nError: ${String(e?.message || e)}`,
          });
        }
      } catch {
        // ignore
      }
    }
  })();
});

app.post('/webhooks/freshchat', async (req, res) => {
  // Optional: implement separate verification if Freshchat supports it.
  const internalMessage = normalizeFreshchatWebhook(req.body || {});

  // Ignore non-user actors to prevent loops.
  if (internalMessage.actorType && internalMessage.actorType !== 'user') {
    return res.status(202).json({ ok: true, ignored: true, reason: 'non_user_actor' });
  }

  if (!internalMessage.conversationId) {
    return res.status(400).json({ ok: false, error: 'missing_conversation_id' });
  }

  res.status(202).json({ ok: true });

  (async () => {
    try {
      if (!freshchat) {
        req.log.warn({ event: 'freshchat_not_configured' }, 'Freshchat webhook received but Freshchat env not configured');
        return;
      }

      const context = await buildContext({ env, freshdesk, freshchat, internalMessage });
      const aiResult = await runAiTurn({ env, claudeClient: claude, toolSchemas, executeTool, internalMessage, context });

      if (env.USE_STUBS && (!env.FRESHCHAT_API_KEY || !env.FRESHCHAT_BOT_AGENT_ID)) {
        req.log.info({ event: 'stub_mode_freshchat_skip_send' }, 'stub mode: skipping Freshchat send');
        return;
      }

      await respondToChat({
        freshchat,
        conversationId: internalMessage.conversationId,
        aiResult,
        botAgentId: env.FRESHCHAT_BOT_AGENT_ID,
        escalationAgentId: env.FRESHCHAT_ESCALATION_AGENT_ID,
      });

      req.log.info({ event: 'freshchat_done', conversationId: internalMessage.conversationId, escalate: aiResult.escalate }, 'handled freshchat webhook');
    } catch (e) {
      req.log.error({ err: { message: e?.message, status: e?.status, data: e?.data } }, 'freshchat webhook processing failed');
    }
  })();
});

app.listen(env.PORT, () => {
  log.info({ port: env.PORT }, 'freshdesk-claude-support listening');
});

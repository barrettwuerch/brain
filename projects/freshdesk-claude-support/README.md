# AI-Powered Customer Support (Claude + Freshdesk)

Middleware service that connects **Freshdesk/Freshchat** webhooks to the **Anthropic Claude API**, with optional **RAG** (Freshdesk Solutions KB → vector search) and **admin portal tool use**.

This is the Phase-1 MVP from the PRD, updated per the wiring guide:
- Receive Freshdesk webhook events for ticket updates/new messages
- Receive Freshchat webhook events for live chat
- Normalize both channels into a shared internal message format
- Assemble context (ticket + conversations + contact) and (best-effort) chat context
- Ask Claude for a response (real Anthropic SDK when keys are present; stub mode otherwise)
- Post reply back to Freshdesk/Freshchat and add an internal agent report note (Freshdesk)
- Escalate when policy says to hand off

## Quick start

```bash
cd projects/freshdesk-claude-support
cp .env.example .env
# fill in env vars
npm run dev
```

Health check:
- `GET http://localhost:8787/health`

Webhook endpoints:
- `POST http://localhost:8787/webhooks/freshdesk`
- `POST http://localhost:8787/webhooks/freshchat`

## Freshdesk setup (recommended)

1. Create a webhook that triggers on **Ticket is created** and **Conversation is created**.
2. Point it to `/webhooks/freshdesk`.
3. Add a shared secret `FRESHDESK_WEBHOOK_SECRET` and configure it in Freshdesk (header `X-Webhook-Secret`) *or* adapt `verifyFreshdeskWebhook()` in code to match Freshdesk’s signature scheme.

## What’s implemented
- Ticket context builder (ticket + recent conversations + contact)
- Claude prompting (system prompt + retrieved KB stubs)
- Tool-call dispatcher (admin portal + Freshdesk actions are stubs; safe-by-default)
- Escalation policy + "handoff" note posting
- Structured audit log lines (JSON) to stdout

## What’s next (Phase 2+)
- Solutions KB sync → pgvector (or Pinecone)
- Real admin portal client
- Approval workflow (refund threshold gating)
- Freshchat low-latency path
- Dashboard metrics

## Notes
- This repo intentionally avoids storing PII long-term; it fetches context on demand from Freshdesk.
- All write operations should be guarded (confirmations + thresholds + audit logging).

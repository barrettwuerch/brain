import crypto from 'node:crypto';

/**
 * Minimal shared-secret verification.
 *
 * Freshdesk webhooks support various auth patterns depending on product/plan.
 * For MVP we support a simple header-based secret.
 *
 * Configure Freshdesk webhook to send header:
 *   X-Webhook-Secret: <same as env FRESHDESK_WEBHOOK_SECRET>
 */
export function verifyFreshdeskWebhook({ req, rawBody, secret, logger }) {
  if (!secret) return { ok: true, mode: 'disabled' };
  const got = req.headers['x-webhook-secret'];
  if (typeof got !== 'string') return { ok: false, reason: 'missing x-webhook-secret' };
  const ok = crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  if (!ok) {
    logger?.warn({ event: 'webhook_auth_failed' }, 'freshdesk webhook secret mismatch');
    return { ok: false, reason: 'bad secret' };
  }
  // rawBody is accepted here so we can later upgrade to signed-body verification.
  void rawBody;
  return { ok: true, mode: 'header-secret' };
}

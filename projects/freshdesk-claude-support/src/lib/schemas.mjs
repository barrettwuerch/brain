import { z } from 'zod';

// Freshdesk webhook payload formats vary by trigger.
// We accept a superset and extract ticket id + last message.
export const freshdeskWebhookSchema = z.object({
  ticket_id: z.union([z.number(), z.string()]).optional(),
  ticket: z.object({
    id: z.union([z.number(), z.string()]).optional(),
  }).optional(),
  conversation: z.object({
    body: z.string().optional(),
    incoming: z.boolean().optional(),
  }).optional(),
  data: z.any().optional(),
}).passthrough();

export function extractTicketId(payload) {
  const id = payload.ticket_id ?? payload.ticket?.id ?? payload?.data?.ticket?.id;
  if (id == null) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

export function extractCustomerMessage(payload) {
  // Prefer conversation body if provided
  const body = payload.conversation?.body ?? payload?.data?.conversation?.body;
  if (typeof body === 'string' && body.trim()) return stripHtml(body);
  return null;
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

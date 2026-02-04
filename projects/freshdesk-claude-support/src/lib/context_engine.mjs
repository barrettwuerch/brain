import { buildTicketContext } from './context.mjs';

export async function buildContext({ env, freshdesk, freshchat, internalMessage }) {
  if (internalMessage.source === 'freshdesk') {
    const ticketId = internalMessage.ticketId;
    const ticketContext = await buildTicketContext({ freshdesk, ticketId });
    return {
      conversationHistory: ticketContext.thread,
      customerData: ticketContext.contact,
      ticketMetadata: { ticketId, subject: ticketContext.ticket.subject, channel: 'ticket' },
      raw: { ticketContext },
    };
  }

  if (internalMessage.source === 'freshchat') {
    // Minimal context for now. You can extend this once we confirm exact Freshchat endpoints.
    const conversationId = internalMessage.conversationId;
    let conversation = null;
    let user = null;
    if (freshchat && conversationId) {
      try { conversation = await freshchat.getConversation(conversationId); } catch { conversation = null; }
    }
    if (freshchat && internalMessage.contactId) {
      try { user = await freshchat.getUser(internalMessage.contactId); } catch { user = null; }
    }

    const history = extractFreshchatHistory(conversation);

    return {
      conversationHistory: history,
      customerData: user,
      ticketMetadata: { ticketId: null, subject: null, channel: 'chat', conversationId },
      raw: { conversation, user },
    };
  }

  throw new Error(`Unknown internalMessage source: ${internalMessage.source}`);
}

function extractFreshchatHistory(conversation) {
  // Freshchat payloads vary. We keep this conservative.
  const msgs = conversation?.messages || conversation?.conversation?.messages || [];
  if (!Array.isArray(msgs)) return [];
  return msgs.slice(-20).map(m => ({
    id: m.id ?? null,
    created_at: m.created_time ?? m.created_at ?? null,
    incoming: (m.actor_type || m.actor?.actor_type) === 'user',
    source: 'freshchat',
    body_text: m?.message_parts?.map(p => p?.text?.content).filter(Boolean).join('\n') || m?.text || '',
  }));
}

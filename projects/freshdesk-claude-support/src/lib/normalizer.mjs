export function normalizeFreshdeskWebhook(payload) {
  return {
    source: 'freshdesk',
    ticketId: payload.ticket_id != null ? Number(payload.ticket_id) : (payload.ticket?.id ? Number(payload.ticket.id) : null),
    conversationId: null,
    contactId: payload.contact_id ?? payload.contactId ?? payload.requester_id ?? null,
    contactEmail: payload.contact_email ?? payload.contactEmail ?? null,
    contactName: payload.contact_name ?? payload.contactName ?? null,
    messageText: payload.latest_reply || payload.latest_public_comment || payload.description || payload.description_text || null,
    subject: payload.subject || null,
    channel: 'ticket',
    priority: payload.priority ?? null,
    status: payload.status ?? null,
    timestamp: new Date().toISOString(),
  };
}

export function normalizeFreshchatWebhook(payload) {
  const actorType = payload?.actor?.actor_type;
  const message = payload?.data?.message;
  const parts = message?.message_parts || [];
  const text = parts.map(p => p?.text?.content).filter(Boolean).join('\n').trim();

  return {
    source: 'freshchat',
    ticketId: null,
    conversationId: message?.conversation_id || message?.channel_id || null,
    contactId: message?.actor_id || payload?.actor?.actor_id || null,
    contactEmail: null,
    contactName: null,
    messageText: text || null,
    subject: null,
    channel: 'chat',
    priority: null,
    status: null,
    timestamp: message?.created_time || new Date().toISOString(),
    actorType,
  };
}

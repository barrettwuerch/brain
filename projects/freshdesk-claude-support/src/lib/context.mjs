export async function buildTicketContext({ freshdesk, ticketId, maxConversations = 15 }) {
  const ticket = await freshdesk.getTicket(ticketId);
  const conv = await freshdesk.listConversations(ticketId);

  const recent = Array.isArray(conv) ? conv.slice(-maxConversations) : [];

  let contact = null;
  if (ticket?.requester_id) {
    try {
      contact = await freshdesk.getContact(ticket.requester_id);
    } catch {
      contact = null;
    }
  }

  const thread = recent.map(c => ({
    id: c.id,
    created_at: c.created_at,
    incoming: Boolean(c.incoming),
    source: c.source,
    body_text: stripHtml(c.body || ''),
  }));

  return {
    ticket: {
      id: ticket?.id,
      subject: ticket?.subject,
      status: ticket?.status,
      priority: ticket?.priority,
      description_text: stripHtml(ticket?.description || ''),
      created_at: ticket?.created_at,
      updated_at: ticket?.updated_at,
      tags: ticket?.tags || [],
    },
    contact: contact ? {
      id: contact?.id,
      name: contact?.name,
      email: contact?.email,
      phone: contact?.phone,
      company_id: contact?.company_id,
    } : null,
    thread,
  };
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

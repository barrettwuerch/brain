export async function respondToTicket({ freshdesk, ticketId, aiResult, escalationGroupId = null } = {}) {
  const { customer_response, agent_report, escalate, toolCalls } = aiResult;

  // Public reply (always)
  if (customer_response) {
    await freshdesk.replyToTicket(ticketId, { body: escapeHtmlToSafeBody(customer_response) });
  }

  // Private agent note (best-effort)
  if (agent_report || (toolCalls && toolCalls.length)) {
    const body = formatAgentNote({ agent_report, toolCalls, escalate });
    try {
      await freshdesk.addPrivateNote(ticketId, { body });
    } catch {
      // non-critical
    }
  }

  // Status updates
  if (escalate) {
    const patch = {
      status: 2, // Open
      priority: 3, // High
    };
    if (escalationGroupId) patch.group_id = escalationGroupId;
    await freshdesk.updateTicket(ticketId, patch);
  } else {
    await freshdesk.updateTicket(ticketId, { status: 3 }); // Pending
  }
}

function formatAgentNote({ agent_report, toolCalls = [], escalate }) {
  const lines = [];
  lines.push('🤖 AI Agent Report');
  if (agent_report) {
    lines.push('');
    lines.push(agent_report);
  }
  if (toolCalls.length) {
    lines.push('');
    lines.push('Tools Used:');
    for (const tc of toolCalls) {
      lines.push(`- ${tc.tool} @ ${tc.ts || tc.timestamp || ''}`);
    }
  }
  if (escalate) {
    lines.push('');
    lines.push('⚠️ ESCALATED: requires human agent attention');
  }
  // Freshdesk notes can accept HTML; we keep plain text for simplicity.
  return lines.map(escapeHtml).join('<br>');
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlToSafeBody(s) {
  // Freshdesk reply body supports HTML. We'll escape and add <br> for newlines.
  return escapeHtml(String(s)).replace(/\n/g, '<br>');
}

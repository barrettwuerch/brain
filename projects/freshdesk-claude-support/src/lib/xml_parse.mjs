export function extractXmlTag(text, tag) {
  const s = String(text || '');
  const re = new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`, 'i');
  const m = s.match(re);
  return m ? m[1] : null;
}

export function parseClaudeXmlResponse(text) {
  const customer = extractXmlTag(text, 'customer_response');
  const agent = extractXmlTag(text, 'agent_report');
  const esc = extractXmlTag(text, 'escalate');
  const escalate = (esc || '').trim().toLowerCase() === 'true';
  return {
    customer_response: (customer ?? text).trim(),
    agent_report: (agent ?? '').trim(),
    escalate,
  };
}

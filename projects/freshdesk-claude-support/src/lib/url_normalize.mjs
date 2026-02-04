export function normalizeFreshdeskDomain(domain) {
  // Accept either "yourcompany" or "yourcompany.freshdesk.com".
  let d = String(domain || '').trim();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!d.includes('.')) {
    // likely subdomain only
    d = `${d}.freshdesk.com`;
  }
  return d;
}

export function normalizeFreshchatApiUrl(url) {
  if (!url) return null;
  const u = String(url).trim().replace(/\/$/, '');
  return u;
}

import { request } from 'undici';
import { normalizeFreshdeskDomain } from '../lib/url_normalize.mjs';

export async function searchKnowledgeBase({ env, query }) {
  if (!env.FRESHDESK_API_KEY) {
    return { ok: false, stub: true, found: false, articles: [], note: 'Freshdesk API key not configured.' };
  }

  const domain = normalizeFreshdeskDomain(env.FRESHDESK_DOMAIN);
  const apiKey = env.FRESHDESK_API_KEY;
  const auth = 'Basic ' + Buffer.from(`${apiKey}:X`).toString('base64');

  // NOTE: Endpoint availability may vary by plan/account. If it fails,
  // we return a graceful "not available" response.
  const url = `https://${domain}/api/v2/search/solutions?term=${encodeURIComponent(query)}`;

  try {
    const res = await request(url, {
      method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
    });

    const text = await res.body.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { ok: false, found: false, articles: [], note: `KB search unavailable (HTTP ${res.statusCode})` };
    }

    const results = data?.results || data?.results?.solutions || data?.solutions || [];
    const top = Array.isArray(results) ? results.slice(0, 3) : [];

    const articles = top.map((a) => ({
      title: a?.title ?? a?.name ?? 'Untitled',
      snippet: (a?.description_text || a?.description || '').toString().slice(0, 500),
      url: a?.url ?? null,
    }));

    return { ok: true, found: articles.length > 0, articles };
  } catch (e) {
    return { ok: false, found: false, articles: [], note: String(e?.message || e) };
  }
}

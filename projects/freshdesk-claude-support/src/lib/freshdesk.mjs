import { request } from 'undici';

function basicAuthHeader(apiKey) {
  // Freshdesk uses API key as username and any password (or blank).
  const token = Buffer.from(`${apiKey}:X`).toString('base64');
  return `Basic ${token}`;
}

import { normalizeFreshdeskDomain } from './url_normalize.mjs';

export class FreshdeskClient {
  constructor({ domain, apiKey, logger }) {
    const nd = normalizeFreshdeskDomain(domain);
    this.baseUrl = `https://${nd}`.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.log = logger;
  }

  async _req(method, path, { query, body } = {}) {
    if (!this.apiKey) throw new Error('Freshdesk API key not configured');

    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v == null) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const res = await request(url, {
      method,
      headers: {
        'Authorization': basicAuthHeader(this.apiKey),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Rate limit headers (best-effort logging)
    const remaining = res.headers['x-ratelimit-remaining'];
    const total = res.headers['x-ratelimit-total'];
    if (remaining != null && total != null) {
      this.log?.debug?.({ remaining, total, path }, 'freshdesk ratelimit');
    }

    const text = await res.body.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (res.statusCode === 429) {
      const err = new Error(`Freshdesk HTTP 429 rate limited ${method} ${path}`);
      const ra = res.headers['retry-after'];
      err.status = 429;
      err.retryAfterMs = ra ? Number(ra) * 1000 : 5000;
      err.data = data;
      throw err;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const err = new Error(`Freshdesk HTTP ${res.statusCode} ${method} ${path}`);
      err.status = res.statusCode;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Tickets
  getTicket(ticketId) {
    return this._req('GET', `/api/v2/tickets/${ticketId}`);
  }

  listConversations(ticketId) {
    return this._req('GET', `/api/v2/tickets/${ticketId}/conversations`);
  }

  // Contacts
  getContact(contactId) {
    return this._req('GET', `/api/v2/contacts/${contactId}`);
  }

  // Conversations
  replyToTicket(ticketId, { body, cc_emails } = {}) {
    return this._req('POST', `/api/v2/tickets/${ticketId}/reply`, {
      body: { body, ...(cc_emails ? { cc_emails } : {}) },
    });
  }

  addPrivateNote(ticketId, { body } = {}) {
    return this._req('POST', `/api/v2/tickets/${ticketId}/notes`, {
      body: { body, private: true },
    });
  }

  updateTicket(ticketId, patch) {
    return this._req('PUT', `/api/v2/tickets/${ticketId}`, { body: patch });
  }
}

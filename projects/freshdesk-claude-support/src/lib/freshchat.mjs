import { request } from 'undici';
import { normalizeFreshchatApiUrl } from './url_normalize.mjs';

export class FreshchatClient {
  constructor({ apiUrl, apiKey, logger }) {
    this.baseUrl = normalizeFreshchatApiUrl(apiUrl);
    this.apiKey = apiKey;
    this.log = logger;
  }

  async _req(method, path, { body } = {}) {
    if (!this.baseUrl) throw new Error('Freshchat apiUrl not configured');
    if (!this.apiKey) throw new Error('Freshchat apiKey not configured');

    const url = this.baseUrl + path;
    const res = await request(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.body.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const err = new Error(`Freshchat HTTP ${res.statusCode} ${method} ${path}`);
      err.status = res.statusCode;
      err.data = data;
      throw err;
    }
    return data;
  }

  getConversation(conversationId) {
    return this._req('GET', `/conversations/${conversationId}`);
  }

  // Some accounts expose /users/:id; others use /agents etc. Adjust as needed.
  getUser(userId) {
    return this._req('GET', `/users/${userId}`);
  }

  sendMessage({ conversationId, actorId, text }) {
    return this._req('POST', `/conversations/${conversationId}/messages`, {
      body: {
        message_parts: [{ text: { content: text } }],
        actor_type: 'agent',
        actor_id: actorId,
        message_type: 'normal',
      },
    });
  }

  assignConversation({ conversationId, agentId }) {
    return this._req('PUT', `/conversations/${conversationId}`, {
      body: { assigned_agent_id: agentId, status: 'assigned' },
    });
  }
}

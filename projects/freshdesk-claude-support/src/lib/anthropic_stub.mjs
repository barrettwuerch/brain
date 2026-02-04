/**
 * Minimal Anthropic client wrapper.
 *
 * This is a stubbed implementation so the service boots without contacting Anthropic.
 * Replace with the official Anthropic SDK in production.
 */

export class ClaudeClient {
  constructor({ apiKey, model, logger, maxToolCallsPerTurn = 6 }) {
    this.apiKey = apiKey;
    this.model = model;
    this.log = logger;
    this.maxToolCallsPerTurn = maxToolCallsPerTurn;
  }

  async generate({ system, messages, tools }) {
    // For MVP scaffold: return a deterministic placeholder.
    // We still log what we'd send.
    this.log.info({ event: 'claude_stub_generate', model: this.model, tools: tools?.length || 0 }, 'Claude stub called');

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUser?.content?.[0]?.text || '(no user message found)';

    return {
      ok: true,
      confidence: 0.5,
      blocks: [
        { type: 'text', text: `I’m not fully wired up to Claude yet, but I received your message:\n\n"${userText}"\n\nIf you paste your order ID or account email, I can look it up once the admin portal tool is connected.` },
      ],
      toolCalls: [],
      raw: null,
    };
  }
}

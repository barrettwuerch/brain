/**
 * Minimal Anthropic client wrapper.
 *
 * This is a stubbed implementation so the service boots without contacting Anthropic.
 * Replace with the official Anthropic SDK in production.
 */

export class ClaudeClientStub {
  constructor({ model, logger }) {
    this.model = model;
    this.log = logger;
  }

  async generateWithTools({ system, messages, tools }) {
    void system;
    void tools;

    this.log.info({ event: 'claude_stub_generate', model: this.model, tools: tools?.length || 0 }, 'Claude stub called');

    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUser?.content?.[0]?.text || lastUser?.content || '(no user message found)';

    return {
      ok: true,
      blocks: [
        {
          type: 'text',
          text:
            `(<customer_response>)\n` +
            `I’m currently running in setup mode (API keys not configured yet), but I received your message and logged it.\n\n` +
            `Message: "${String(userText).slice(0, 800)}"\n\n` +
            `If you share your account email and any transaction/order ID, I can investigate once tools are connected.\n` +
            `</customer_response>\n` +
            `(<agent_report>)\n` +
            `Stub mode: Claude/Freshdesk/Freshchat keys not configured. No tools executed.\n` +
            `</agent_report>\n` +
            `(<escalate>)false</escalate>`,
        },
      ],
      toolCalls: [],
      raw: null,
    };
  }
}

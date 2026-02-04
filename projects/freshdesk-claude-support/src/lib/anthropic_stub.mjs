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
            `<customer_response>\n` +
            `Thanks — I received your message. I'm going to need one detail to look this up: could you share the email on your Wedge account (or the approximate amount/date of the transaction)?\n` +
            `</customer_response>\n` +
            `<agent_report>\n` +
            `Stub mode (keys not configured). No tools executed. Awaiting customer clarification to proceed.\n` +
            `Last message (truncated): ${String(userText).slice(0, 400)}\n` +
            `</agent_report>\n` +
            `<escalate>false</escalate>`,
        },
      ],
      toolCalls: [],
      raw: null,
    };
  }
}

import Anthropic from '@anthropic-ai/sdk';

/**
 * Real Claude client with tool-use loop.
 *
 * If env.USE_STUBS is true or ANTHROPIC_API_KEY is missing, callers should
 * use the stub client instead.
 */
export class ClaudeClient {
  constructor({ apiKey, model, logger, maxTokens = 2048, maxToolRounds = 5 }) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.log = logger;
    this.maxTokens = maxTokens;
    this.maxToolRounds = maxToolRounds;
  }

  /**
   * @param {object} params
   * @param {string} params.system
   * @param {Array} params.messages
   * @param {Array} params.tools
   * @param {function(string, object): Promise<object>} params.executeTool
   */
  async generateWithTools({ system, messages, tools, executeTool }) {
    let currentMessages = [...messages];
    const toolCalls = [];

    for (let round = 1; round <= this.maxToolRounds; round++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        tools,
        messages: currentMessages,
      });

      this.log.info({
        event: 'claude_response',
        round,
        stopReason: response.stop_reason,
        usage: response.usage,
      });

      if (response.stop_reason === 'end_turn') {
        return { ok: true, blocks: response.content, toolCalls, raw: response };
      }

      if (response.stop_reason !== 'tool_use') {
        return {
          ok: true,
          blocks: [{ type: 'text', text: 'I’m having trouble completing that request. I’m going to escalate this to a human agent.' }],
          toolCalls,
          raw: response,
          forcedEscalate: true,
        };
      }

      // Add assistant tool_use blocks to history
      currentMessages.push({ role: 'assistant', content: response.content });

      // Execute tool calls
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        toolCalls.push({ tool: block.name, input: block.input, id: block.id, ts: new Date().toISOString() });

        let result;
        try {
          result = await executeTool(block.name, block.input);
        } catch (e) {
          result = { ok: false, error: String(e?.message || e) };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results as user content blocks
      currentMessages.push({ role: 'user', content: toolResults });
    }

    return {
      ok: true,
      blocks: [{ type: 'text', text: 'I’m having difficulty resolving this and will connect you with a human agent.' }],
      toolCalls,
      raw: null,
      forcedEscalate: true,
    };
  }
}

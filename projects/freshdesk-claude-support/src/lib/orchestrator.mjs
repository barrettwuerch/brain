import { buildSystemPrompt } from '../policies/system_prompt.mjs';
import { shouldEscalate } from '../policies/escalation.mjs';

export class Orchestrator {
  constructor({ env, freshdesk, claude, tools, dispatcher, rag, logger }) {
    this.env = env;
    this.freshdesk = freshdesk;
    this.claude = claude;
    this.tools = tools;
    this.dispatcher = dispatcher;
    this.rag = rag;
    this.log = logger;
  }

  async handleTicketMessage({ ticketContext, customerMessageText }) {
    // Phase 2+: RAG search based on ticket/customer message.
    const ragResults = await this.rag.search(customerMessageText);

    const system = buildSystemPrompt({
      brandName: 'Support',
      refundApprovalThresholdUsd: this.env.REFUND_APPROVAL_THRESHOLD_USD,
    });

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: renderUserPacket({ ticketContext, customerMessageText, ragResults }),
          },
        ],
      },
    ];

    const res = await this.claude.generate({ system, messages, tools: this.tools });

    // Tool loop (stub client currently returns none).
    let toolCalls = res.toolCalls || [];
    let toolResults = [];
    let toolCallCount = 0;

    while (toolCalls.length && toolCallCount < this.env.MAX_TOOL_CALLS_PER_TURN) {
      const tc = toolCalls.shift();
      toolCallCount++;
      const out = await this.dispatcher.runTool(tc.name, tc.input, { ticketId: ticketContext.ticket.id });
      toolResults.push({ name: tc.name, ok: true, output: out });
      // In a real implementation, you would feed tool results back into Claude and continue.
      break;
    }

    const text = blocksToText(res.blocks || []);

    const esc = shouldEscalate({
      confidence: res.confidence,
      // TODO: parse customerRequestedHuman/frustration from message + model output
      attempts: 0,
      needsApproval: false,
      outOfScope: false,
      frustration: false,
    });

    return {
      ok: true,
      replyText: text,
      escalate: esc.escalate,
      escalationReason: esc.reason,
      toolResults,
      model: this.env.ANTHROPIC_MODEL,
    };
  }
}

function renderUserPacket({ ticketContext, customerMessageText, ragResults }) {
  return [
    `CUSTOMER MESSAGE:\n${customerMessageText}`,
    '',
    `TICKET:\n${JSON.stringify(ticketContext.ticket, null, 2)}`,
    '',
    `CONTACT:\n${JSON.stringify(ticketContext.contact, null, 2)}`,
    '',
    `THREAD (recent):\n${JSON.stringify(ticketContext.thread, null, 2)}`,
    '',
    `KNOWLEDGE BASE RESULTS:\n${JSON.stringify(ragResults, null, 2)}`,
  ].join('\n');
}

function blocksToText(blocks) {
  return blocks
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim();
}

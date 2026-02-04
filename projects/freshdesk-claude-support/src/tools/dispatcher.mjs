import { z } from 'zod';

const refundArgs = z.object({
  order_id: z.string(),
  amount_usd: z.number(),
  reason: z.string(),
  customer_confirmed: z.boolean(),
});

const updateArgs = z.object({
  customer_id: z.string(),
  field: z.string(),
  new_value: z.string(),
  customer_confirmed: z.boolean(),
});

export class ToolDispatcher {
  constructor({ env, freshdesk, rag, adminPortal, logger }) {
    this.env = env;
    this.freshdesk = freshdesk;
    this.rag = rag;
    this.admin = adminPortal;
    this.log = logger;
  }

  async runTool(toolName, input, { ticketId } = {}) {
    switch (toolName) {
      case 'search_knowledge_base':
        return this.rag.search(input?.query_text || '');

      case 'lookup_order':
        return this.admin.lookupOrder(input);

      case 'check_subscription':
        return this.admin.checkSubscription(input);

      case 'process_refund': {
        const args = refundArgs.parse(input);
        if (!args.customer_confirmed) {
          return { ok: false, error: 'customer_confirmation_required' };
        }
        if (args.amount_usd > this.env.REFUND_APPROVAL_THRESHOLD_USD) {
          return { ok: false, error: 'requires_human_approval', threshold: this.env.REFUND_APPROVAL_THRESHOLD_USD };
        }
        return this.admin.processRefund(args);
      }

      case 'update_account': {
        const args = updateArgs.parse(input);
        if (!args.customer_confirmed) {
          return { ok: false, error: 'customer_confirmation_required' };
        }
        return this.admin.updateAccount(args);
      }

      case 'escalate_to_human': {
        if (!ticketId) throw new Error('ticketId required for escalate_to_human');
        const reason = input?.reason || 'unspecified';
        const priority = input?.priority || 'normal';
        const summary = input?.summary || '';
        await this.freshdesk.addPrivateNote(ticketId, {
          body: `🤖 AI Escalation\nReason: ${reason}\nPriority: ${priority}\n\nSummary:\n${summary}`,
        });
        // Optional: update ticket priority/status here.
        return { ok: true };
      }

      default:
        return { ok: false, error: `unknown_tool:${toolName}` };
    }
  }
}

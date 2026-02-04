/** Tool registry (Claude tool-use compatible).
 *
 * In Phase 1, tools are mostly stubs. You can safely enable read tools first.
 */

export function getToolSchemas({ refundApprovalThresholdUsd = 50 } = {}) {
  return [
    {
      name: 'lookup_order',
      description: 'Retrieve order status and details from the admin portal.',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID (preferred)' },
          customer_email: { type: 'string', description: 'Customer email (fallback)' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'check_subscription',
      description: 'Retrieve subscription/plan details for a customer.',
      input_schema: {
        type: 'object',
        properties: { customer_id: { type: 'string' } },
        required: ['customer_id'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_knowledge_base',
      description: 'Search the internal knowledge base for relevant articles/snippets.',
      input_schema: {
        type: 'object',
        properties: { query_text: { type: 'string' } },
        required: ['query_text'],
        additionalProperties: false,
      },
    },
    {
      name: 'process_refund',
      description: `Initiate a refund. Refunds above $${refundApprovalThresholdUsd} require human approval.`,
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          amount_usd: { type: 'number' },
          reason: { type: 'string' },
          customer_confirmed: { type: 'boolean', description: 'Must be true if customer explicitly confirmed the refund.' },
        },
        required: ['order_id', 'amount_usd', 'reason', 'customer_confirmed'],
        additionalProperties: false,
      },
    },
    {
      name: 'update_account',
      description: 'Modify customer account settings. Requires customer confirmation for sensitive fields.',
      input_schema: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          field: { type: 'string' },
          new_value: { type: 'string' },
          customer_confirmed: { type: 'boolean' },
        },
        required: ['customer_id', 'field', 'new_value', 'customer_confirmed'],
        additionalProperties: false,
      },
    },
    {
      name: 'escalate_to_human',
      description: 'Escalate the ticket to a human agent with a summary and priority.',
      input_schema: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          summary: { type: 'string' },
        },
        required: ['reason', 'priority', 'summary'],
        additionalProperties: false,
      },
    },
  ];
}

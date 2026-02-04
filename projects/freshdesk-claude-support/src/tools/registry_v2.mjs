export function getToolSchemasV2() {
  return [
    {
      name: 'lookup_plaid_balance',
      description: 'Look up a customer\'s Plaid-linked bank account balance and connection status. Use for failed/pending transactions.',
      input_schema: {
        type: 'object',
        properties: {
          customer_email: { type: 'string', description: 'Customer email used to find linked Plaid account.' },
          customer_id: { type: 'string', description: 'Internal customer ID if email unavailable.' },
        },
        required: ['customer_email'],
        additionalProperties: false,
      },
    },
    {
      name: 'check_transaction_status',
      description: 'Check status of a transaction (or recent transactions). Must return status: processing|needs_funds|failed|completed and relevant metadata.',
      input_schema: {
        type: 'object',
        properties: {
          customer_email: { type: 'string' },
          transaction_id: { type: 'string', description: 'Optional transaction ID. If omitted, return recent.' },
        },
        required: ['customer_email'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_knowledge_base',
      description: 'Search the internal knowledge base for relevant articles.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Short query describing what customer is asking.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ];
}

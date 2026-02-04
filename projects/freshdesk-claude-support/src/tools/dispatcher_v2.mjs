import { lookupPlaidBalance } from './plaid.mjs';
import { checkTransactionStatus } from './transactions.mjs';
import { searchKnowledgeBase } from './knowledge_base.mjs';

export function makeToolExecutor({ env, logger }) {
  return async function executeTool(name, input) {
    logger?.info({ tool: name }, 'tool_call');

    switch (name) {
      case 'lookup_plaid_balance':
        return lookupPlaidBalance(input);
      case 'check_transaction_status':
        return checkTransactionStatus(input);
      case 'search_knowledge_base':
        return searchKnowledgeBase({ env, query: input?.query });
      default:
        return { ok: false, error: `unknown_tool:${name}` };
    }
  };
}

export function makeAdminPortal({ env, logger }) {
  return {
    async lookupOrder({ order_id, customer_email } = {}) {
      logger?.info({ tool: 'lookup_order', order_id, customer_email }, 'admin portal stub');
      return { ok: false, error: 'admin_portal_not_configured' };
    },
    async checkSubscription({ customer_id } = {}) {
      logger?.info({ tool: 'check_subscription', customer_id }, 'admin portal stub');
      return { ok: false, error: 'admin_portal_not_configured' };
    },
    async processRefund({ order_id, amount_usd, reason } = {}) {
      logger?.info({ tool: 'process_refund', order_id, amount_usd, reason }, 'admin portal stub');
      return { ok: false, error: 'admin_portal_not_configured' };
    },
    async updateAccount({ customer_id, field, new_value } = {}) {
      logger?.info({ tool: 'update_account', customer_id, field }, 'admin portal stub');
      return { ok: false, error: 'admin_portal_not_configured' };
    },
  };
}

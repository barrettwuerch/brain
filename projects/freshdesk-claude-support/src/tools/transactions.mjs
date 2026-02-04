export async function checkTransactionStatus({ customer_email, transaction_id } = {}) {
  // TODO: Replace with real admin portal API call.
  return {
    ok: false,
    stub: true,
    found: false,
    note: 'Admin portal not wired yet (placeholder mode).',
    customer_email,
    transaction_id,
  };
}

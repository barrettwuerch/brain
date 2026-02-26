import 'dotenv/config';

import {
  getAccount,
  getBars,
  getOrders,
  getPosition,
  placeOrder,
} from '../lib/alpaca';

async function main() {
  const acct = await getAccount();

  // Data
  const bars = await getBars('BTC/USD', '1d', 5);

  // Orders (place a tiny limit far away so it should just rest; then cancel via existing cancelOrder if needed)
  // We'll avoid cancel here to keep it simple/non-destructive; just verify placeOrder returns.
  const client_order_id = `smoke-${Date.now()}`;
  const order = await placeOrder({
    symbol: 'AAPL',
    qty: '1',
    side: 'buy',
    type: 'limit',
    time_in_force: 'day',
    limit_price: '1.00',
    client_order_id,
  });

  const orders = await getOrders();

  // Position: may not exist; this call will throw if none. Handle gracefully.
  let pos: any = null;
  try {
    pos = await getPosition('AAPL');
  } catch (e: any) {
    pos = { error: String(e?.message ?? e) };
  }

  console.log({
    account: { status: acct.status, equity: acct.equity, buying_power: acct.buying_power },
    bars_count: bars.length,
    last_bar: bars[bars.length - 1],
    placed_order: { id: order.id, client_order_id: order.client_order_id, status: order.status, symbol: order.symbol, type: order.type, limit_price: order.limit_price },
    open_orders_count: orders.length,
    position_aapl: pos,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

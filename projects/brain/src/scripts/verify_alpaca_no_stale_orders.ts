import 'dotenv/config';

import { getOrders } from '../lib/alpaca';

async function main() {
  const orders = await getOrders();
  const aapl = orders.filter((o) => o.symbol === 'AAPL');
  console.log({ open_orders: orders.length, aapl_orders: aapl.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

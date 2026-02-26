import 'dotenv/config';

import { getBalance } from '../lib/kalshi';

async function main() {
  const balance = await getBalance();
  console.log({
    balance_cents: balance.balance,
    balance_dollars: (balance.balance / 100).toFixed(2),
  });
}

main().catch((e: any) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});

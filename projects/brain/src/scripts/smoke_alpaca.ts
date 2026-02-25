import 'dotenv/config';

import { getAccount } from '../lib/alpaca';

async function main() {
  const account = await getAccount();

  console.log({
    status: account.status,
    equity: account.equity,
    buying_power: account.buying_power,
    pattern_day_trader: account.pattern_day_trader,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

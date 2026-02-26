import 'dotenv/config';

import { computeResearchMarketContext } from '../bots/research/market_context';

async function main() {
  const ticker = process.argv[2] ?? 'KXNBASPREAD-26FEB26WASATL-WAS5';
  const ctx = await computeResearchMarketContext({ market_type: 'prediction', ticker });
  console.log(JSON.stringify({ ticker, ctx }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

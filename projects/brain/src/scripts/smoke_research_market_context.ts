import 'dotenv/config';

import { computeResearchMarketContext } from '../bots/research/market_context';

async function main() {
  const ctxCrypto = await computeResearchMarketContext({ market_type: 'crypto', symbol: 'BTC/USD' });
  // prediction context requires a ticker; skip if none provided.
  console.log(JSON.stringify({ ctxCrypto }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

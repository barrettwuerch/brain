import 'dotenv/config';

import { reconcileSufficientOutcomes } from '../db/strategy_outcomes';

async function main() {
  const limit = Number(process.env.RECONCILE_LIMIT ?? 25);
  await reconcileSufficientOutcomes(limit);
  console.log(`Reconciled up to ${limit} sufficient outcomes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

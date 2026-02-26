import 'dotenv/config';

import { attributePerformance } from '../bots/intelligence/attribution';

async function main() {
  const out = await attributePerformance();
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import 'dotenv/config';

import { runScannerCycle } from '../bots/scanner/scanner_loop';

async function main() {
  console.log('=== SCANNER CYCLE ===');
  const result = await runScannerCycle();
  console.log('Checked:', result.conditionsChecked);
  console.log('Fired:', result.fired);
  console.log('Tasks created:', result.tasksCreated);
  console.log('=== DONE ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

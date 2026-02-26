import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { handleAssessStrategicPriorities } from '../bots/cos/cos_handlers';

async function main() {
  // This handler calls the loaders (IS trajectory, regime, pipeline health,
  // circuit breakers, strategy outcomes) but does not send email.
  const out = await handleAssessStrategicPriorities({ task_input: { report_date: 'n/a' } }, supabaseAdmin);
  console.log(JSON.stringify({ ok: true, out }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  // Reset bots that were mass-paused during Gate tests.
  // Schema uses current_state (not state).
  const { data, error } = await supabaseAdmin
    .from('bot_states')
    .update({
      current_state: 'exploiting',
      reason: 'manual_reset_pre_simulation',
      current_drawdown: 0,
      warm_up: false,
      warm_up_episodes_remaining: 0,
      requires_manual_review: false,
      updated_at: new Date().toISOString(),
    })
    .in('current_state', ['paused', 'diagnostic', 'recovering', 'cautious']);

  if (error) throw error;

  console.log(JSON.stringify({ ok: true, updated_rows: data?.length ?? null }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

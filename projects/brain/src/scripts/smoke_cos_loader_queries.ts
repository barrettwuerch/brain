import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const bots = await supabaseAdmin
    .from('bot_states')
    .select('bot_id,current_state,updated_at,reason,current_drawdown')
    .order('bot_id', { ascending: true })
    .limit(5);

  const trans = await supabaseAdmin
    .from('bot_state_transitions')
    .select('created_at,bot_id,reason')
    .ilike('reason', 'circuit_breaker%')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);

  const is = await supabaseAdmin
    .from('intelligence_scores')
    .select('task_type,value,created_at')
    .eq('metric', 'intelligence_score')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log(
    JSON.stringify(
      {
        bot_states_sample: bots.data ?? [],
        breaker_transitions_sample: trans.data ?? [],
        intelligence_scores_sample: is.data ?? [],
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

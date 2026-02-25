import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  // Ensure execution bot is tradeable for this verification.
  await supabaseAdmin.from('bot_states').upsert(
    {
      bot_id: 'execution-bot-1',
      agent_role: 'execution',
      desk: 'prediction_markets',
      current_state: 'exploiting',
      state_since: new Date().toISOString(),
      current_drawdown: 0,
      requires_manual_review: false,
      warm_up: false,
      warm_up_episodes_remaining: 0,
      diagnostic_attempts: 0,
      diagnostic_max: 10,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'bot_id' },
  );

  // AAPL should always be > 0.01, so this fires immediately.
  const wc: any = {
    strategy_id: 'gateB3b',
    bot_id: 'execution-bot-1',
    market_type: 'equity',
    ticker: 'AAPL',
    condition_type: 'threshold',
    metric: 'price',
    operator: '>',
    value: 0.01,
    timeframe: '1h',
    action_type: 'size_position',
    action_params: {
      continuation: {
        task_type: 'place_limit_order',
        agent_role: 'execution',
        bot_id: 'execution-bot-1',
        desk: 'prediction_markets',
        task_input: {
          symbol: 'AAPL',
          side: 'buy',
          limitPrice: 1.0,
        },
      },
    },
    max_triggers_per_day: 10,
    cooldown_minutes: 0,
    active_hours: null,
    vol_regime_gate: null,
    status: 'active',
    last_triggered: null,
    trigger_count: 0,
    expires_at: null,
    registered_by: 'gateB3b',
  };

  const { data, error } = await supabaseAdmin.from('watch_conditions').insert(wc).select('id').single();
  if (error) throw error;

  console.log('seeded_watch_condition', data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

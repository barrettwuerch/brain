import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const finding_id = 'ab8f5d72-b814-4a1b-bb16-68af54fd7913';

  const formalization: any = {
    finding_id,
    market_scope: 'KXFED-25MAR-T5.25',
    market_type: 'prediction_markets',
    entry_condition:
      "yes_bid < 0.93 AND time_to_resolution <= 48h AND vol_regime IN ('LOW','NORMAL') AND no_fed_speaker_in_window = true",
    exit_condition:
      'yes_bid >= 0.97 (profit target) OR yes_bid <= 0.88 (stop loss) OR resolution',
    position_sizing_rule:
      'Kelly fraction: p=0.78, b=0.97/0.07=13.86, f*=0.755, apply 40% fractional = 0.302 of risk capital',
    invalidation_criteria: 'Fed speaker event fires in window, vol_regime shifts to ELEVATED or EXTREME',
    regime_gate: 'LOW or NORMAL vol only',
    mechanism:
      'Uncertainty discount compression: market underprices hold probability early in resolution window. Compression is exploitable when no new information is expected (no Fed speakers) and prior meeting held. Historical base rate 78% across 18 observations.',
    failure_conditions:
      'Fed speaker surprise, inflation print, regime shift, crowded trade in low-vol high-predictability environment',
  };

  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'challenge_strategy',
    task_input: { finding_id, formalization },
    status: 'queued',
    tags: ['strategy', 'prediction_markets', 'gate1', 'preformalized'],
    agent_role: 'strategy',
    desk: 'prediction_markets',
    bot_id: 'strategy-bot-1',
  });
  if (error) throw error;

  console.log('Seeded pre-formalized challenge_strategy task for Gate 1.', { finding_id });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

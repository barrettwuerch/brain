import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const finding: any = {
    bot_id: 'research-bot-1',
    desk: 'prediction_markets',
    market_type: 'prediction',
    agent_role: 'research',
    finding_type: 'under_investigation',
    edge_type: 'behavioral',

    market: 'FED-HOLD-MAR2026',

    description:
      "Fed Hold Compression (Gate1): Edge: In the final 48 hours before the March 2026 FOMC decision, if no Fed speakers are scheduled and the prior meeting held, the YES contract for 'Fed holds rates' tends to compress toward 0.95+ as uncertainty collapses. Base rate: ~78% of hold decisions show this compression pattern. Entry: BUY YES when price < 0.88 within 48h of resolution AND no Fed speaker events in the calendar. Exit: hold to resolution or sell if price reaches 0.96. Stop: exit if price drops below 0.82. Kelly sizing: use 40% of full Kelly due to sample uncertainty. Regime gate: only trade in LOW or NORMAL vol regime.",

    mechanism:
      'As the decision approaches, conditional uncertainty resolves. When no Fed communication is scheduled and prior meeting held, participants converge on a hold outcome; late buyers push YES price upward. Mispricing exists when price < 0.88 within 48h, leaving convexity to 1.00 at resolution.',

    failure_conditions:
      'Fails on surprise macro prints, unscheduled Fed communications, or sudden risk-off shocks; fails if volatility regime is ELEVATED/EXTREME; fails if within 48h but price already >= 0.90 (insufficient edge) or if market is illiquid/spread wide.',

    regime_notes: 'Only trade in LOW/NORMAL vol regimes. Do not trade during volatility transitions.',

    // Gate 1 requirements
    rqs_score: 0.7,
    rqs_components: {
      statistical_rigor: 0.72,
      mechanism_clarity: 0.55, // triggers validate_edge_mechanism seed branch
      novelty: 0.68,
      cost_adjusted_edge: 0.85,
    },

    sample_size: 300,
    observed_rate: 0.78,
    base_rate: 0.7,
    lift: 0.08,
    out_of_sample: true,

    status: 'under_investigation',
    recommendation: 'pass_to_backtest',
    backtest_result: null,
    supporting_episode_ids: [],
    notes: 'Gate1 synthetic: constructed to proceed challenge + seed validate_edge_mechanism branch.',
    parent_finding_id: null,
  };

  const { data, error } = await supabaseAdmin
    .from('research_findings')
    .insert(finding)
    .select('id')
    .maybeSingle();
  if (error) throw error;

  console.log('seeded_finding_id', (data as any)?.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

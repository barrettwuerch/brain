import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { getCryptoOHLCV } from './data_feed';

function outcomesFromCloses(closes: number[]): number[] {
  // Simple proxy outcomes: 1 if close increased vs prior, else 0.
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push(closes[i] > closes[i - 1] ? 1 : 0);
  }
  return out;
}

async function main() {
  // Prefer passed_to_backtest crypto findings; fallback to most recent preliminary.
  const { data: passed } = await supabaseAdmin
    .from('research_findings')
    .select('*')
    .eq('market_type', 'crypto')
    .eq('status', 'passed_to_backtest')
    .order('created_at', { ascending: false })
    .limit(1);

  let finding = (passed ?? [])[0] as any;
  if (!finding) {
    const { data } = await supabaseAdmin
      .from('research_findings')
      .select('*')
      .eq('market_type', 'crypto')
      .eq('finding_type', 'preliminary')
      .order('created_at', { ascending: false })
      .limit(1);
    finding = (data ?? [])[0] as any;
  }

  if (!finding) throw new Error('No crypto research findings available to seed crypto strategy tasks.');

  const bars = await getCryptoOHLCV('BTC/USD', '1d', 120);
  const closes = bars.map((b) => b.close);
  const outcomes = outcomesFromCloses(closes);

  const slippage = 0.001; // crypto standard (0.1%), never 0

  const { error: ins1 } = await supabaseAdmin.from('tasks').insert({
    task_type: 'formalize_crypto_strategy',
    task_input: {
      finding,
      slippage_assumption: slippage,
      position_sizing_rule: 'fractional_kelly_0.20x',
      time_limit: '7 days maximum hold',
    },
    status: 'queued',
    tags: ['strategy', 'crypto'],
    agent_role: 'strategy',
    desk: 'crypto_markets',
    bot_id: 'crypto-strategy-bot-1',
  });
  if (ins1) throw ins1;

  const { error: ins2 } = await supabaseAdmin.from('tasks').insert({
    task_type: 'run_crypto_backtest',
    task_input: {
      formalization: {
        finding_id: finding.id,
        entry_conditions: 'stub',
        exit_conditions: 'stub',
        position_sizing_rule: 'fractional_kelly_0.20x',
        invalidation_criteria: 'IS drops below 0.05 for 2 consecutive evaluations',
        market_scope: finding.market ?? 'BTC/USD',
        created_at: new Date().toISOString(),
        created_by: 'crypto-strategy-bot-1',
        watch_condition: {
          metric: 'volume_ratio',
          operator: '>=',
          value: 2,
          timeframe: '1d',
          vol_regime_gate: 'elevated',
          cooldown_minutes: 60,
          max_triggers_per_day: 3,
        },
      },
      outcomes,
      slippage,
    },
    status: 'queued',
    tags: ['strategy', 'crypto'],
    agent_role: 'strategy',
    desk: 'crypto_markets',
    bot_id: 'crypto-strategy-bot-1',
  });
  if (ins2) throw ins2;

  console.log('Seeded 2 crypto strategy tasks (formalize_crypto_strategy, run_crypto_backtest).', { finding_id: finding.id });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

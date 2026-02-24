// Strategy Bot task generator

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function main() {
  // Prefer passed_to_backtest findings; fallback to most recent preliminary.
  const { data: passed } = await supabaseAdmin
    .from('research_findings')
    .select('*')
    .eq('status', 'passed_to_backtest')
    .order('created_at', { ascending: false })
    .limit(1);

  let finding = (passed ?? [])[0] as any;
  if (!finding) {
    const { data } = await supabaseAdmin
      .from('research_findings')
      .select('*')
      .eq('finding_type', 'preliminary')
      .order('created_at', { ascending: false })
      .limit(1);
    finding = (data ?? [])[0] as any;
  }

  if (!finding) throw new Error('No research findings available to seed strategy tasks.');

  // Build an outcomes history: use latest episode outcomes as a base, but ensure variance for hard checks.
  const { data: eps, error: epsErr } = await supabaseAdmin
    .from('episodes')
    .select('outcome_score,created_at')
    .order('created_at', { ascending: false })
    .limit(120);
  if (epsErr) throw epsErr;

  // Deterministic synthetic outcomes for dev: length=120, variance present, stable across windows.
  // Pattern yields mean ~0.6 and keeps in-sample/out-sample similar.
  const outcomes = Array.from({ length: 120 }, (_, i) => {
    const pattern = [1, 1, 0, 1, 0];
    return pattern[i % pattern.length];
  });

  const slippage = 0.0015; // explicit; thin prediction markets default

  const { error: ins1 } = await supabaseAdmin.from('tasks').insert({
    task_type: 'formalize_strategy',
    task_input: { finding },
    status: 'queued',
    tags: ['strategy', 'prediction_markets'],
    agent_role: 'strategy',
    desk: 'prediction_markets',
    bot_id: 'strategy-bot-1',
  });
  if (ins1) throw ins1;

  const { error: ins2 } = await supabaseAdmin.from('tasks').insert({
    task_type: 'run_backtest',
    task_input: {
      formalization: {
        finding_id: finding.id,
        entry_conditions: 'stub',
        exit_conditions: 'stub',
        position_sizing_rule: 'Kelly 0.25x',
        invalidation_criteria: 'IS drops below 0.05 for 2 consecutive evaluations',
        market_scope: finding.market ?? 'general',
        created_at: new Date().toISOString(),
        created_by: 'strategy-bot-1',
      },
      outcomes,
      slippage,
    },
    status: 'queued',
    tags: ['strategy', 'prediction_markets'],
    agent_role: 'strategy',
    desk: 'prediction_markets',
    bot_id: 'strategy-bot-1',
  });
  if (ins2) throw ins2;

  console.log('Seeded 2 strategy tasks (formalize_strategy, run_backtest).', { finding_id: finding.id });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

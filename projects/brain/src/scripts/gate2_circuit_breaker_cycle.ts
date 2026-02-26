import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';

async function ensureBot(bot_id: string, agent_role: string, desk: string) {
  const { data } = await supabaseAdmin.from('bot_states').select('*').eq('bot_id', bot_id).maybeSingle();
  if (data) return;
  await supabaseAdmin.from('bot_states').insert({
    bot_id,
    agent_role,
    desk,
    current_state: 'exploiting',
    warm_up: false,
    warm_up_episodes_remaining: 0,
    updated_at: new Date().toISOString(),
  });
}

async function fetchTransitions(bot_id: string) {
  const { data, error } = await supabaseAdmin
    .from('bot_state_transitions')
    .select('created_at,from_state,to_state,reason,metric_snapshot')
    .eq('bot_id', bot_id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function runEvaluateCircuitBreakersOnce() {
  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      task_type: 'evaluate_circuit_breakers',
      task_input: { note: 'gate2' },
      status: 'running',
      tags: ['gate2'],
      agent_role: 'risk',
      desk: 'prediction_markets',
      bot_id: 'risk-bot-1',
    })
    .select('*')
    .single();
  if (error) throw error;

  const loop = new BrainLoop();
  const out = await loop.run(task as any);
  return out;
}

async function main() {
  const bot_id = process.argv[2] ?? 'execution-bot-1';
  await ensureBot(bot_id, 'execution', 'prediction_markets');

  // Step 1: set drawdown above maxDrawdownFromPeak (0.15) and run evaluate.
  await supabaseAdmin.from('bot_states').update({ current_drawdown: 0.16, updated_at: new Date().toISOString() }).eq('bot_id', bot_id);
  await runEvaluateCircuitBreakersOnce();

  // Step 2: reset drawdown to 0 and run evaluate (should transition paused->recovering)
  await supabaseAdmin.from('bot_states').update({ current_drawdown: 0.0, updated_at: new Date().toISOString() }).eq('bot_id', bot_id);
  await runEvaluateCircuitBreakersOnce();

  // Step 3: orchestrator recovery completion (recovering->cautious) is handled in reviewAndTransitionBots.
  const { reviewAndTransitionBots } = await import('../bots/orchestrator/routing');
  await reviewAndTransitionBots();

  const rows = await fetchTransitions(bot_id);
  console.log(JSON.stringify({ bot_id, transitions: rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

const task_type = 'formalize_strategy';
const bot_id = 'strategy-bot-1';
const desk = 'prediction_markets';
const agent_role = 'strategy';

function mk(i: number, outcome_score: number, reasoning_score: number) {
  return {
    task_id: null,
    task_type,
    task_input: { gate: '3', case: i },
    agent_role,
    desk,
    bot_id,
    reasoning: `Gate3 seed episode ${i}`,
    action_taken: { gate3: true, i },
    observation: {},
    reflection: 'seed',
    lessons: [],
    outcome: outcome_score > 0.6 ? 'correct' : outcome_score < 0.4 ? 'incorrect' : 'partial',
    outcome_score,
    reasoning_score,
    error_type: null,
    ttl_days: 30,
    embedding: null,
    vol_regime: 'normal',
  };
}

async function main() {
  // Ensure we have >=10 episodes so computeAccuracyTrend/computeCalibration are not "insufficient_data".
  const good: Array<[number, number]> = [
    [0.85, 0.8],
    [0.86, 0.82],
    [0.83, 0.78],
    [0.84, 0.81],
  ];
  const mid: Array<[number, number]> = [
    [0.52, 0.48],
    [0.5, 0.45],
    [0.55, 0.5],
  ];
  const bad: Array<[number, number]> = [
    [0.2, 0.25],
    [0.25, 0.2],
    [0.3, 0.28],
  ];

  const episodes = [...good, ...mid, ...bad].map((p, idx) => mk(idx + 1, p[0], p[1]));

  // Clear prior Gate3 seed episodes for this task_type to keep the window clean.
  await supabaseAdmin.from('episodes').delete().eq('task_type', task_type).ilike('reasoning', 'Gate3 seed episode%');

  const { error } = await supabaseAdmin.from('episodes').insert(episodes);
  if (error) throw error;

  console.log('seeded_gate3_episodes', { task_type, count: episodes.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

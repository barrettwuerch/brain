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
    task_input: { gate: '3', case: `poor_${i}` },
    agent_role,
    desk,
    bot_id,
    reasoning: `Gate3 poor seed episode ${i}`,
    action_taken: { gate3: true, poor: true, i },
    observation: {},
    reflection: 'seed',
    lessons: [],
    outcome: 'incorrect',
    outcome_score,
    reasoning_score,
    error_type: 'strategy_error',
    ttl_days: 30,
    embedding: null,
    vol_regime: 'normal',
  };
}

async function main() {
  const bad: Array<[number, number]> = [
    [0.2, 0.25],
    [0.22, 0.2],
    [0.25, 0.22],
    [0.18, 0.2],
    [0.3, 0.28],
    [0.26, 0.24],
    [0.24, 0.2],
    [0.28, 0.25],
    [0.21, 0.19],
    [0.27, 0.23],
  ];

  // Do not delete prior episodes; we want these to be the most recent and drive the score downward.
  const episodes = bad.map((p, idx) => mk(idx + 1, p[0], p[1]));

  const { error } = await supabaseAdmin.from('episodes').insert(episodes);
  if (error) throw error;

  console.log('seeded_gate3_poor_episodes', { task_type, count: episodes.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { writeIntelligenceScore } from '../evaluation/intelligence_score';

async function insertEpisode(args: {
  task_type: string;
  bot_id: string;
  agent_role: string;
  desk: string;
  outcome_score: number;
  reasoning_score: number;
}) {
  const { task_type, bot_id, agent_role, desk, outcome_score, reasoning_score } = args;
  const { error } = await supabaseAdmin.from('episodes').insert({
    task_id: null,
    task_type,
    task_input: { gate: 3 },
    agent_role,
    desk,
    bot_id,
    reasoning: `gate3 seed outcome_score=${outcome_score}`,
    action_taken: { gate: 3 },
    observation: { gate: 3 },
    reflection: 'gate3',
    lessons: [],
    outcome: outcome_score >= 0.66 ? 'correct' : outcome_score >= 0.33 ? 'partial' : 'incorrect',
    outcome_score,
    reasoning_score,
    error_type: null,
    ttl_days: 1,
    embedding: null,
    vol_regime: 'normal',
  });
  if (error) throw error;
}

async function main() {
  const task_type = 'gate3_test';
  const bot_id = process.argv[2] ?? 'execution-bot-1';

  // Clean previous runs
  await supabaseAdmin.from('episodes').delete().eq('task_type', task_type);
  await supabaseAdmin.from('intelligence_scores').delete().eq('task_type', task_type);

  const xs = [0.85, 0.5, 0.15];

  // Gate 3 pass condition: prove IS is sensitive to outcome quality.
  // We compute three separate IS points, each over a window containing a single seeded episode.
  // (This avoids confounding from averaging across mixed-quality episodes.)
  for (const x of xs) {
    await supabaseAdmin.from('episodes').delete().eq('task_type', task_type);

    // Keep reasoning_score aligned with outcome_score so calibration is not adversarial.
    await insertEpisode({
      task_type,
      bot_id,
      agent_role: 'execution',
      desk: 'prediction_markets',
      outcome_score: x,
      reasoning_score: x,
    });

    await writeIntelligenceScore(task_type);
  }

  const { data, error } = await supabaseAdmin
    .from('intelligence_scores')
    .select('id,created_at,task_type,metric,value,notes')
    .eq('task_type', task_type)
    .eq('metric', 'intelligence_score')
    .order('created_at', { ascending: true });
  if (error) throw error;

  console.log(JSON.stringify({ task_type, bot_id, scores: data }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

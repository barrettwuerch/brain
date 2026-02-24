// Phase 2 runner: pull one queued task, reason, act, grade, log.

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';

async function fetchOneQueuedTask() {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as any;
}

async function main() {
  const task = await fetchOneQueuedTask();
  if (!task) {
    console.log('No queued tasks. Seed some with: npm run dev:seed:level1');
    return;
  }

  // Mark running to avoid double-processing in parallel.
  await supabaseAdmin.from('tasks').update({ status: 'running' }).eq('id', task.id);

  const loop = new BrainLoop();

  console.log('=== TASK ===');
  console.log({ id: task.id, task_type: task.task_type, task_input: task.task_input });

  const out = await loop.run(task);

  if ('aborted' in out) {
    console.log('\n=== ABORTED ===');
    console.log(out);
    return;
  }

  console.log('\n=== SUMMARY ===');
  console.log({
    outcome: out.episode.outcome,
    outcome_score: out.episode.outcome_score,
    reasoning_score: out.episode.reasoning_score,
    episode_id: out.store.episode_id,
  });
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

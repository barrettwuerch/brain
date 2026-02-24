// Phase 3 runner: pull tasks until queue empty, run full loop, sleep between.

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';
import { reconcileSufficientOutcomes } from '../db/strategy_outcomes';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchNextQueued() {
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
  const loop = new BrainLoop();
  let n = 0;

  while (true) {
    const task = await fetchNextQueued();
    if (!task) {
      // Maintenance: reconcile any sufficient outcomes even when no tasks are queued.
      try {
        await reconcileSufficientOutcomes(25);
      } catch {}

      console.log('Queue empty. Done.');
      break;
    }

    // claim task
    await supabaseAdmin.from('tasks').update({ status: 'running' }).eq('id', task.id);

    try {
      const out = await loop.run(task);

      if ('aborted' in out) {
        console.log(`#${n + 1} task=${task.task_type} ABORTED reason=${out.reason}`);
      } else {
        n++;
        console.log(
          `#${n} task=${task.task_type} outcome=${out.episode.outcome} outcome_score=${out.episode.outcome_score} reasoning_score=${out.episode.reasoning_score} episode_id=${out.store.episode_id}`,
        );
        // TEMP (Phase 4 verification): show reasoning so we can confirm MEMORY CONTEXT injection.
        if (String(process.env.BRAIN_DEBUG_REASONING || '').toLowerCase() === 'true') {
          console.log('reasoning:', out.episode.reasoning);
        }
      }
    } catch (e: any) {
      console.error('Task failed:', task.id, e?.message ?? e);
      await supabaseAdmin.from('tasks').update({ status: 'failed' }).eq('id', task.id);
    }

    await sleep(2000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

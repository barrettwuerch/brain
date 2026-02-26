// Phase 3 runner: pull tasks until queue empty, run full loop, sleep between.

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';

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

  let lastHeartbeatAt = 0;

  while (true) {
    const task = await fetchNextQueued();
    if (!task) {
      // IMPORTANT: on Railway we want a long-running worker.
      // Keep polling instead of exiting, otherwise the container will stop and "loop health" will go stale.
      if (n % 30 === 0) console.log('Queue empty. Waiting...');

      // Emit a lightweight heartbeat episode every ~5 minutes so the Front Office can prove the loop is alive
      // even when there are no queued tasks.
      const now = Date.now();
      if (now - lastHeartbeatAt > 5 * 60 * 1000) {
        lastHeartbeatAt = now;
        try {
          await supabaseAdmin.from('episodes').insert({
            task_id: null,
            task_type: 'loop_heartbeat',
            task_input: { source: 'run_loop' },
            agent_role: 'orchestrator',
            desk: 'general',
            bot_id: 'orchestrator-1',
            reasoning: 'Loop heartbeat',
            action_taken: { ok: true },
            observation: { ok: true },
            reflection: null,
            lessons: [],
            outcome: 'success',
            outcome_score: 1,
            reasoning_score: 1,
            error_type: null,
            ttl_days: 1,
            embedding: null,
            vol_regime: 'normal',
          } as any);
        } catch (e: any) {
          console.warn('heartbeat insert failed:', e?.message ?? e);
        }
      }

      await sleep(5000);
      continue;
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

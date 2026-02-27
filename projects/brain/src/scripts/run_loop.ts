// Phase 3 runner: pull tasks until queue empty, run full loop, sleep between.

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';
import { runScannerCycle } from '../bots/scanner/scanner_loop';

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
  let lastScannerAt = 0;

  console.log('[LOOP] Starting Brain loop with scanner integration');

  while (true) {
    // ── Scanner: run every 60 seconds ──────────────────────────────────────
    const now = Date.now();
    if (now - lastScannerAt > 60 * 1000) {
      lastScannerAt = now;
      try {
        console.log('[LOOP] Running scanner cycle...');
        const result = await runScannerCycle();
        console.log(`[LOOP] Scanner done — checked=${result.conditionsChecked} fired=${result.fired} tasks=${result.tasksCreated}`);
      } catch (e: any) {
        console.error('[LOOP] Scanner cycle failed:', e?.message ?? e);
      }
    }

    // ── Heartbeat: every 5 minutes ──────────────────────────────────────────
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
        console.warn('[LOOP] Heartbeat insert failed:', e?.message ?? e);
      }
    }

    // ── Task processing ─────────────────────────────────────────────────────
    const task = await fetchNextQueued();
    if (!task) {
      if (n % 12 === 0) console.log('[LOOP] Queue empty. Waiting...');
      n++;
      await sleep(5000);
      continue;
    }

    // Reset counter when tasks are flowing
    n = 0;

    // Claim task
    await supabaseAdmin.from('tasks').update({ status: 'running' }).eq('id', task.id);

    try {
      const out = await loop.run(task);

      if ('aborted' in out) {
        console.log(`[LOOP] task=${task.task_type} ABORTED reason=${out.reason}`);
      } else {
        console.log(
          `[LOOP] task=${task.task_type} outcome=${out.episode.outcome} score=${out.episode.outcome_score} episode=${out.store.episode_id}`,
        );
        if (String(process.env.BRAIN_DEBUG_REASONING || '').toLowerCase() === 'true') {
          console.log('reasoning:', out.episode.reasoning);
        }
      }
    } catch (e: any) {
      console.error('[LOOP] Task failed:', task.id, e?.message ?? e);
      await supabaseAdmin.from('tasks').update({ status: 'failed' }).eq('id', task.id);
    }

    await sleep(2000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

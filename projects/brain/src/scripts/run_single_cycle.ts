import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { runScannerCycle } from '../bots/scanner/scanner_loop';
import { BrainLoop } from '../agent/loop';

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

async function markStatus(id: string, status: string) {
  const { error } = await supabaseAdmin.from('tasks').update({ status }).eq('id', id);
  if (error) throw error;
}

async function main() {
  console.log('[single_cycle] running scanner cycle...');
  const scan = await runScannerCycle();
  console.log('[single_cycle] scanner:', scan);

  const task = await fetchNextQueued();
  if (!task) {
    console.log('[single_cycle] no queued tasks after scanner.');
    return;
  }

  console.log(`[single_cycle] running one queued task id=${task.id} type=${task.task_type} role=${task.agent_role}`);
  await markStatus(task.id, 'running');

  const loop = new BrainLoop();
  try {
    const out = await loop.run(task);
    if ('aborted' in out) {
      console.log('[single_cycle] aborted:', out);
      await markStatus(task.id, 'failed');
      return;
    }
    await markStatus(task.id, 'completed');
    console.log('[single_cycle] completed. episode:', out.episode?.id);
  } catch (e: any) {
    console.error('[single_cycle] error:', e?.message ?? e);
    await markStatus(task.id, 'failed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

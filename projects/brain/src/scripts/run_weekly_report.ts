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
  await supabaseAdmin.from('tasks').insert({
    task_type: 'generate_weekly_report',
    task_input: { window_days: 7, include_trajectory: true },
    status: 'queued',
    tags: ['intelligence', 'weekly'],
    agent_role: 'intelligence',
    desk: 'all_desks',
    bot_id: 'intelligence-bot-1',
  });

  const loop = new BrainLoop();

  while (true) {
    const task = await fetchNextQueued();
    if (!task) {
      console.log('Queue empty. Done.');
      break;
    }

    await supabaseAdmin.from('tasks').update({ status: 'running' }).eq('id', task.id);

    try {
      await loop.run(task);
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

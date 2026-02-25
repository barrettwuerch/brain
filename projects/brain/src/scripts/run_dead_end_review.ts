import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';

async function main() {
  await supabaseAdmin.from('tasks').insert({
    task_type: 'review_dead_ends',
    task_input: { lookback_days: 90, cluster_threshold: 3 },
    status: 'queued',
    tags: ['orchestrator', 'dead_ends'],
    agent_role: 'orchestrator',
    desk: 'all_desks',
    bot_id: 'orchestrator-1',
  });

  const loop = new BrainLoop();
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('task_type', 'review_dead_ends')
    .eq('status', 'queued')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!task) return;
  await supabaseAdmin.from('tasks').update({ status: 'running' }).eq('id', (task as any).id);
  await loop.run(task as any);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';

async function insertAndRunSize(drawdownPct: number, baseKellySize: number) {
  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      task_type: 'size_position',
      task_input: { drawdownPct, baseKellySize },
      status: 'running',
      tags: ['gate4'],
      agent_role: 'risk',
      desk: 'prediction_markets',
      bot_id: 'risk-bot-1',
    })
    .select('*')
    .single();
  if (error) throw error;

  const loop = new BrainLoop();
  const out = await loop.run(task as any);
  if ('aborted' in out) throw new Error('aborted');
  return {
    task_id: (task as any).id,
    result: out.episode.observation ?? out.episode.action_taken ?? out.episode.observation,
  };
}

async function main() {
  const base = 100;
  const a0 = await insertAndRunSize(0.0, base);
  const a1 = await insertAndRunSize(0.10, base);
  const a2 = await insertAndRunSize(0.20, base);

  console.log(JSON.stringify({ baseKellySize: base, drawdown0: a0, drawdown10: a1, drawdown20: a2 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

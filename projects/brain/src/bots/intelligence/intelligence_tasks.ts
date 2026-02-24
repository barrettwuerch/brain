import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['intelligence'],
    agent_role: 'intelligence',
    desk: 'general',
    bot_id: 'intelligence-bot-1',
  });
  if (error) throw error;
}

async function main() {
  await insertTask('consolidate_memories', {});
  await insertTask('attribute_performance', {});
  console.log('Seeded intelligence tasks.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

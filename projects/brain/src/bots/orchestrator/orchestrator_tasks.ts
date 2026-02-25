import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function insertTask(task_type: string, task_input: Record<string, any> = {}) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['orchestrator'],
    agent_role: 'orchestrator',
    desk: 'general',
    bot_id: 'orchestrator-1',
  });
  if (error) throw error;
}

async function main() {
  await insertTask('route_research_findings', {});
  await insertTask('register_watch_conditions', {});
  await insertTask('review_bot_states', {});
  await insertTask('generate_priority_map', {});
  await insertTask('monitor_approved_findings', { lookback_days: 30, market_type: 'prediction' });
  await insertTask('monitor_approved_findings', { lookback_days: 30, market_type: 'crypto' });
  await insertTask('update_stale_watch_conditions', {});
  console.log('Seeded orchestrator tasks.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

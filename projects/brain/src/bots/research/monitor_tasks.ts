import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function insertTask(row: any) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    ...row,
    status: 'queued',
    tags: ['research', 'monitor'],
    agent_role: 'research',
  });
  if (error) throw error;
}

async function main() {
  await insertTask({
    task_type: 'monitor_approved_findings',
    task_input: { lookback_days: 30, market_type: 'prediction' },
    bot_id: 'research-bot-1',
    desk: 'prediction_markets',
  });

  await insertTask({
    task_type: 'monitor_approved_findings',
    task_input: { lookback_days: 30, market_type: 'crypto' },
    bot_id: 'crypto-research-bot-1',
    desk: 'crypto_markets',
  });

  console.log('Seeded monitor_approved_findings tasks (prediction + crypto).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

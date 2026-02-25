import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const baseKellySize = 100; // dollars
  const drawdownPct = 0.16; // should produce k=0.1 → approved_size=10

  const continuation = {
    task_type: 'place_limit_order',
    agent_role: 'execution',
    bot_id: 'execution-bot-1',
    desk: 'prediction_markets',
    task_input: {
      symbol: 'AAPL',
      side: 'buy',
      limitPrice: 1.0,
    },
  };

  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'size_position',
    task_input: { drawdownPct, baseKellySize, continuation },
    status: 'queued',
    tags: ['gateB-bridge'],
    bot_id: 'risk-bot-1',
    agent_role: 'risk',
    desk: 'prediction_markets',
  });
  if (error) throw error;

  console.log('Seeded size_position with continuation.', { drawdownPct, baseKellySize });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

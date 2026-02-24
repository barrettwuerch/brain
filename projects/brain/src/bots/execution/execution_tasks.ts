// Execution Bot task generator (paper mode)

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['execution', 'prediction_markets'],
    agent_role: 'execution',
    desk: 'prediction_markets',
    bot_id: 'execution-bot-1',
  });
  if (error) throw error;
}

async function main() {
  const ticker = 'KXBTC15M-TEST';

  // Guard case: not tradeable due to resolution < 2h
  await insertTask('evaluate_market_conditions', {
    ticker,
    spread: 0.02,
    avg_spread: 0.01,
    hoursToResolution: 1.0,
    openInterest: 800,
  });

  await insertTask('compute_position_size', {
    edgeEstimate: 0.02,
    kelly_fraction: 0.6,
    account_equity: 10000,
    openInterest: 5000,
  });

  const { data: f } = await supabaseAdmin
    .from('research_findings')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const strategy_id = f ? String((f as any).id) : null;

  await insertTask('place_limit_order', {
    ticker,
    side: 'yes',
    size: 60,
    limit_price: 0.52,
    openInterest: 800,
    hoursToResolution: 24,
    spread: 0.01,
    avg_spread: 0.01,
    riskApprovedSize: 60,
    stop_level: 0.45,
    profit_target: 0.60,
    strategy_id,
  });

  await insertTask('manage_open_position', {
    order: {
      order_id: 'ord_demo',
      bot_id: 'execution-bot-1',
      market_ticker: ticker,
      market_type: 'prediction',
      order_type: 'limit',
      side: 'yes',
      size: 60,
      limit_price: 0.52,
      fill_price: 0.521,
      fill_size: 60,
      status: 'filled',
      slippage: 0.001,
      attempt_count: 1,
      created_at: new Date().toISOString(),
      filled_at: new Date().toISOString(),
    },
    current_price: 0.60,
    stop_level: 0.45,
    profit_target: 0.60,
  });

  console.log('Seeded execution tasks.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

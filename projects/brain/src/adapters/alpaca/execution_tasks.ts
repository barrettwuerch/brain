import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { getCryptoQuote } from './data_feed';

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['execution', 'crypto'],
    agent_role: 'execution',
    desk: 'crypto_markets',
    bot_id: 'crypto-execution-bot-1',
  });
  if (error) throw error;
}

async function main() {
  const ticker = 'BTC/USD';
  const q = await getCryptoQuote(ticker);
  const bid = q.bid;
  const spread = q.spread;

  await insertTask('evaluate_crypto_market_conditions', {
    ticker,
    spreadPct: spread / Math.max((q.bid + q.ask) / 2, 1e-9),
    volRegime: 'normal',
  });

  await insertTask('compute_crypto_position_size', {
    edgeEstimate: 0.03,
    kellyFraction: 0.2,
    accountEquity: 10000,
    openInterest: 999999,
    market_type: 'crypto',
    volRegime: 'normal',
  });

  await insertTask('place_crypto_limit_order', {
    ticker,
    side: 'buy',
    size: 0.001,
    limit_price: bid,
    openInterest: 999999,
    hoursToResolution: 999,
    market_type: 'crypto',
    riskApprovedSize: 0.001,
    stop_level: bid * 0.97,
    profit_target: bid * 1.05,
    strategy_id: null,
    spreadPct: spread / Math.max((q.bid + q.ask) / 2, 1e-9),
    volRegime: 'normal',
  });

  await insertTask('manage_crypto_position', {
    order: {
      order_id: 'ord_crypto_demo',
      bot_id: 'crypto-execution-bot-1',
      market_ticker: ticker,
      market_type: 'crypto',
      order_type: 'limit',
      side: 'buy',
      size: 0.001,
      limit_price: bid,
      fill_price: bid,
      fill_size: 0.001,
      status: 'filled',
      slippage: 0.0,
      attempt_count: 1,
      created_at: new Date().toISOString(),
      filled_at: new Date().toISOString(),
    },
    current_price: q.ask,
    stop_level: bid * 0.97,
    profit_target: bid * 1.05,
  });

  console.log('Seeded crypto execution tasks.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function run() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: conditions } = await sb
    .from('watch_conditions')
    .select('id, ticker, action_params')
    .eq('market_type', 'crypto')
    .eq('action_type', 'place_limit_order')
    .eq('status', 'active');

  for (const c of conditions ?? []) {
    const symbol = String(c.ticker);
    const continuation = {
      task_type: 'place_limit_order',
      agent_role: 'execution',
      bot_id: 'crypto-execution-bot-1',
      desk: 'crypto_markets',
      task_input: {
        symbol,
        ticker: symbol,
        market_type: 'crypto',
        side: 'buy',
        limitPrice: (c.action_params as any)?.limitPrice ?? null,
        useMarketPrice: true,
        stop_level: null,
        profit_target: null,
      },
    };

    const { error } = await sb
      .from('watch_conditions')
      .update({
        action_type: 'size_position',
        bot_id: 'risk-bot-1',
        action_params: {
          symbol,
          market_type: 'crypto',
          side: 'buy',
          continuation,
        },
      })
      .eq('id', c.id);

    console.log(error ? `[ERROR] ${symbol}: ${error.message}` : `[FIXED] ${symbol} → size_position → place_limit_order`);
  }

  const { data: final } = await sb
    .from('watch_conditions')
    .select('ticker, action_type, bot_id, status')
    .eq('status', 'active');
  console.log('\n--- Active conditions ---');
  console.table(final);
}

run().catch(console.error);

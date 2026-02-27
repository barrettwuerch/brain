import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const positions = [
    {
      bot_id: 'crypto-execution-bot-1',
      desk: 'crypto_markets',
      market_ticker: 'ETHUSD',
      market_type: 'crypto',
      side: 'yes',
      entry_price: 2031.62,
      current_price: 2031.62,
      size: 160,
      remaining_size: 160,
      stop_level: 2031.62 * 0.95,
      profit_target: 2031.62 * 1.10,
      slippage_assumed: 0.001,
      status: 'open',
    },
    {
      bot_id: 'crypto-execution-bot-1',
      desk: 'crypto_markets',
      market_ticker: 'SOLUSD',
      market_type: 'crypto',
      side: 'yes',
      entry_price: 87.22,
      current_price: 87.22,
      size: 320,
      remaining_size: 320,
      stop_level: 87.22 * 0.95,
      slippage_assumed: 0.001,
      profit_target: 87.22 * 1.10,
      status: 'open',
    },
  ];

  for (const p of positions) {
    const { data: existing } = await sb.from('positions')
      .select('id').eq('market_ticker', p.market_ticker).eq('status', 'open').maybeSingle();
    if (existing) { console.log('Already tracked:', p.market_ticker); continue; }
    const { error } = await sb.from('positions').insert(p);
    if (error) console.error('Failed:', p.market_ticker, error.message);
    else console.log('Backfilled:', p.market_ticker, 'stop=' + p.stop_level.toFixed(2), 'target=' + p.profit_target.toFixed(2));
  }
}
main().catch(console.error);

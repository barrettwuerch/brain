import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  // 1. Disable AAPL equity condition — no equity handler exists
  await sb.from('watch_conditions').update({ status: 'paused' })
    .eq('ticker', 'AAPL').eq('market_type', 'equity');
  console.log('[PAUSED] AAPL equity — no handler');

  // 2. Expire all Feb 26 Kalshi markets — they settled yesterday
  const expiredTickers = [
    'KXQUICKSETTLE-26FEB26H1900-3',
    'KXQUICKSETTLE-26FEB26H1900-2',
    'KXDARTSMATCH-26FEB26GPRIGVAN-GVAN',
    'KXDARTSMATCH-26FEB26GPRIGVAN-GPRI',
    'KXNBABLK-26FEB26MIAPHI-MIABADEBAYO13-3',
  ];
  for (const ticker of expiredTickers) {
    await sb.from('watch_conditions').update({ status: 'expired' }).eq('ticker', ticker);
    console.log(`[EXPIRED] ${ticker} — market settled`);
  }

  // 3. Fix BTC/USD size_position — remove extreme vol_regime_gate
  await sb.from('watch_conditions')
    .update({
      vol_regime_gate: null,
      action_params: {
        symbol: 'BTC/USD',
        market_type: 'crypto',
        side: 'buy',
        strategy: 'momentum',
      }
    })
    .eq('ticker', 'BTC/USD')
    .eq('action_type', 'size_position');
  console.log('[FIXED] BTC/USD size_position — removed extreme vol_regime_gate');

  // 4. Fix crypto place_limit_order conditions — limitPrice: 1 is wrong, use market price signal
  // Set limitPrice to null so execution bot uses live market price
  for (const ticker of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
    const { data } = await sb.from('watch_conditions')
      .select('id, action_params')
      .eq('ticker', ticker)
      .eq('action_type', 'place_limit_order')
      .eq('market_type', 'crypto');
    
    for (const row of data ?? []) {
      const params = { ...(row.action_params ?? {}), limitPrice: null, useMarketPrice: true };
      await sb.from('watch_conditions').update({ action_params: params }).eq('id', row.id);
      console.log(`[FIXED] ${ticker} place_limit_order — limitPrice set to market price`);
    }
  }

  // 5. Print final active conditions
  const { data: final } = await sb
    .from('watch_conditions')
    .select('ticker, market_type, action_type, bot_id, vol_regime_gate, status')
    .in('status', ['active'])
    .order('created_at');

  console.log('\n--- Active conditions after cleanup ---');
  console.table(final);
}

run().catch(console.error);

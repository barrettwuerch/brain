import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function authHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  };
}

async function run() {
  const BASE = (process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '');
  const res = await fetch(`${BASE}/v2/positions`, { headers: authHeaders() });
  const positions = await res.json() as any[];
  console.log(`Found ${positions.length} open Alpaca positions`);

  for (const p of positions) {
    const ticker = String(p.symbol);
    const entry = Number(p.avg_entry_price);
    const qty = Number(p.qty);
    const side = String(p.side) === 'long' ? 'yes' : 'no';
    const stop = entry * (side === 'buy' ? 0.95 : 1.05);
    const target = entry * (side === 'buy' ? 1.10 : 0.90);

    const { data: existing } = await sb
      .from('positions')
      .select('id')
      .eq('market_ticker', ticker)
      .is('closed_at', null)
      .maybeSingle();

    if (existing) {
      console.log(`SKIP ${ticker} — already tracked`);
      continue;
    }

    const { data, error } = await sb.from('positions').insert({
      bot_id: 'crypto-execution-bot-1',
      desk: 'crypto_markets',
      market_ticker: ticker,
      market_type: 'crypto',
      side,
      entry_price: entry,
      size: Math.round(qty * 1e8),
      remaining_size: Math.round(qty * 1e8),
      stop_level: stop,
      profit_target: target,
      status: "open",
      slippage_assumed: 0,
    }).select('id').single();

    if (error) {
      console.error(`ERROR ${ticker}:`, error.message);
    } else {
      console.log(`OK ${ticker} — entry=${entry} qty=${qty} stop=${stop.toFixed(2)} target=${target.toFixed(2)}`);
    }
  }
}

run().catch(console.error);

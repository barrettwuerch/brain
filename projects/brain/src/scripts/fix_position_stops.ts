import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data } = await sb.from('positions').select('id,market_ticker,entry_price,side').is('closed_at', null).eq('market_type', 'crypto');
  for (const p of data ?? []) {
    const entry = Number((p as any).entry_price);
    const isLong = String((p as any).side) === 'yes';
    const stop = entry * (isLong ? 0.95 : 1.05);
    const target = entry * (isLong ? 1.10 : 0.90);
    const { error } = await sb.from('positions').update({ stop_level: stop, profit_target: target }).eq('id', (p as any).id);
    console.log(error ? `ERROR ${(p as any).market_ticker}: ${error.message}` : `OK ${(p as any).market_ticker} stop=${stop.toFixed(2)} target=${target.toFixed(2)}`);
  }
}

run().catch(console.error);

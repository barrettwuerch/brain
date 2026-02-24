import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const { data, error } = await supabaseAdmin
    .from('positions')
    .select('id,created_at,market_ticker,side,status,entry_price,current_price,unrealized_pnl,exit_reason')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  console.log('positions (latest 10)');
  for (const r of data ?? []) {
    console.log({
      id: (r as any).id,
      ticker: (r as any).market_ticker,
      side: (r as any).side,
      status: (r as any).status,
      entry_price: (r as any).entry_price,
      current_price: (r as any).current_price,
      unrealized_pnl: (r as any).unrealized_pnl,
      exit_reason: (r as any).exit_reason,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

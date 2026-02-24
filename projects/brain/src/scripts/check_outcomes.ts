import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const { data, error } = await supabaseAdmin
    .from('strategy_outcomes')
    .select('strategy_id,market_type,total_trades,win_rate,profit_factor,total_pnl,status,matches_backtest,divergence_pct,created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  console.log('strategy_outcomes (latest 50)');
  for (const r of data ?? []) {
    const row: any = r;
    console.log(
      `${row.created_at} ${row.strategy_id} ${row.market_type} trades=${row.total_trades} win_rate=${row.win_rate ?? 'n/a'} pf=${row.profit_factor ?? 'n/a'} pnl=${row.total_pnl} status=${row.status} matches=${row.matches_backtest ?? 'n/a'} div=${row.divergence_pct ?? 'n/a'}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

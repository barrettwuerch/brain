import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { getMarkets } from '../lib/kalshi';

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  console.log('Seeding watch conditions...');

  // 1) Top 5 Kalshi open markets by volume.
  const markets = await getMarkets({ status: 'open', limit: 200 });
  const top5 = (markets ?? [])
    .filter((m: any) => m && m.ticker)
    .sort((a: any, b: any) => Number((b as any).volume ?? 0) - Number((a as any).volume ?? 0))
    .slice(0, 5);

  console.log('Top 5 Kalshi markets by volume:');
  for (const m of top5) {
    console.log(` ${m.ticker} — volume: ${Number((m as any).volume ?? 0)}`);
  }

  // 2) Build watch condition rows matching the schema.
  // We use a "volume_24h > 0" threshold so the condition is usually true when market data is live,
  // but cooldown + max_triggers_per_day prevent spamming.
  const kalshiConditions = top5.map((m: any) => ({
    strategy_id: 'simulation_seed',
    bot_id: 'execution-bot-1',
    market_type: 'prediction',
    ticker: String(m.ticker),

    condition_type: 'threshold',
    metric: 'volume_24h',
    operator: '>',
    value: 0.0,
    timeframe: '1h',

    action_type: 'alert_only',
    action_params: {
      note: 'seed_watch_conditions',
      market_ticker: String(m.ticker),
    },

    max_triggers_per_day: 3,
    cooldown_minutes: 60,
    active_hours: null,
    vol_regime_gate: null,

    status: 'active',
    expires_at: null,
    registered_by: 'seed_watch_conditions',
  }));

  const cryptoSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
  const cryptoConditions = cryptoSymbols.map((symbol) => ({
    strategy_id: 'simulation_seed',
    bot_id: 'crypto-execution-bot-1',
    market_type: 'crypto',
    ticker: symbol,

    condition_type: 'threshold',
    metric: 'volume_ratio',
    operator: '>',
    value: 1.5,
    timeframe: '1h',

    action_type: 'alert_only',
    action_params: {
      symbol,
      note: 'seed_watch_conditions',
    },

    max_triggers_per_day: 3,
    cooldown_minutes: 60,
    active_hours: null,
    vol_regime_gate: null,

    status: 'active',
    expires_at: null,
    registered_by: 'seed_watch_conditions',
  }));

  const all = [...kalshiConditions, ...cryptoConditions];

  // NOTE: watch_conditions doesn't have a composite unique constraint on (ticker,market_type,strategy_id)
  // in the current schema, so upsert can't target that.
  // For the simulation kickoff it's fine to insert fresh rows each run.
  const { error } = await supabaseAdmin.from('watch_conditions').insert(all as any);

  if (error) throw error;

  console.log(`\n✅ Seeded ${all.length} watch conditions:`);
  console.log(` ${kalshiConditions.length} Kalshi prediction markets`);
  console.log(` ${cryptoConditions.length} crypto symbols`);
  console.log('\nScanner will pick these up on the next loop cycle.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

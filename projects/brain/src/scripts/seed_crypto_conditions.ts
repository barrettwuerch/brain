import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabase';

const TICKERS = ['BTC/USD', 'ETH/USD', 'SOL/USD'];

async function main() {
  // First deactivate the dummy seed conditions
  await supabaseAdmin
    .from('watch_conditions')
    .update({ status: 'paused' })
    .eq('strategy_id', 'simulation_seed')
    .eq('market_type', 'crypto');
  console.log('Paused dummy seed conditions');

  for (const ticker of TICKERS) {
    const symbol = ticker.replace('/', '');
    const botId = 'crypto-execution-bot-1';

    // Condition 1: Volume spike — above average volume signals momentum
    await supabaseAdmin.from('watch_conditions').insert({
      strategy_id: 'crypto_baseline_v1',
      bot_id: 'risk-bot-1',
      market_type: 'crypto',
      ticker,
      condition_type: 'threshold',
      metric: 'volume_ratio',
      operator: '>',
      value: 1.5,
      timeframe: '1h',
      action_type: 'size_position',
      action_params: {
        side: 'buy',
        symbol: ticker,
        market_type: 'crypto',
      },
      max_triggers_per_day: 3,
      cooldown_minutes: 240,
      status: 'active',
      registered_by: 'seed_crypto_conditions',
    } as any);
    console.log(`Seeded volume_ratio condition for ${ticker}`);

    // Condition 2: Low vol regime — enter when market is calm
    await supabaseAdmin.from('watch_conditions').insert({
      strategy_id: 'crypto_baseline_v1',
      bot_id: 'risk-bot-1',
      market_type: 'crypto',
      ticker,
      condition_type: 'threshold',
      metric: 'vol_regime',
      operator: '<',
      value: 2,
      timeframe: '1d',
      action_type: 'size_position',
      action_params: {
        side: 'buy',
        symbol: ticker,
        market_type: 'crypto',
      },
      max_triggers_per_day: 2,
      cooldown_minutes: 360,
      status: 'active',
      registered_by: 'seed_crypto_conditions',
    } as any);
    console.log(`Seeded vol_regime condition for ${ticker}`);
  }

  console.log('Done seeding crypto baseline conditions');
}

main().catch(e => { console.error(e); process.exit(1); });

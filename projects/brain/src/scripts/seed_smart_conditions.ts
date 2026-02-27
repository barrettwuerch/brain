import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function makeContinuation(symbol: string, side: 'buy' | 'sell') {
  return {
    side,
    symbol,
    market_type: 'crypto',
    continuation: {
      desk: 'crypto_markets',
      bot_id: 'crypto-execution-bot-1',
      task_type: 'place_limit_order',
      agent_role: 'execution',
      task_input: {
        side,
        symbol,
        ticker: symbol,
        limitPrice: null,
        stop_level: null,
        market_type: 'crypto',
        profit_target: null,
        useMarketPrice: true,
      },
    },
  };
}

const conditions = [
  // ── Strategy 1: Volume surge momentum (buy when volume spikes 1.5x avg) ──
  {
    strategy_id: 'volume_momentum_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'BTC/USD',
    condition_type: 'threshold',
    metric: 'volume_ratio',
    operator: '>',
    value: 1.5,
    timeframe: '1d',
    action_type: 'size_position',
    action_params: makeContinuation('BTC/USD', 'buy'),
    max_triggers_per_day: 4,
    cooldown_minutes: 360,
    vol_regime_gate: 'elevated', // only in normal or below
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },
  {
    strategy_id: 'volume_momentum_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'ETH/USD',
    condition_type: 'threshold',
    metric: 'volume_ratio',
    operator: '>',
    value: 1.5,
    timeframe: '1d',
    action_type: 'size_position',
    action_params: makeContinuation('ETH/USD', 'buy'),
    max_triggers_per_day: 4,
    cooldown_minutes: 360,
    vol_regime_gate: 'elevated',
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },
  {
    strategy_id: 'volume_momentum_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'SOL/USD',
    condition_type: 'threshold',
    metric: 'volume_ratio',
    operator: '>',
    value: 1.5,
    timeframe: '1d',
    action_type: 'size_position',
    action_params: makeContinuation('SOL/USD', 'buy'),
    max_triggers_per_day: 4,
    cooldown_minutes: 360,
    vol_regime_gate: 'elevated',
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },

  // ── Strategy 2: Funding rate mean reversion (sell when funding > 0.1%) ──
  {
    strategy_id: 'funding_mean_reversion_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'BTC/USD',
    condition_type: 'threshold',
    metric: 'funding_rate',
    operator: '>',
    value: 0.001,
    timeframe: '1h',
    action_type: 'size_position',
    action_params: makeContinuation('BTC/USD', 'sell'),
    max_triggers_per_day: 2,
    cooldown_minutes: 720,
    vol_regime_gate: null,
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },
  {
    strategy_id: 'funding_mean_reversion_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'ETH/USD',
    condition_type: 'threshold',
    metric: 'funding_rate',
    operator: '>',
    value: 0.001,
    timeframe: '1h',
    action_type: 'size_position',
    action_params: makeContinuation('ETH/USD', 'sell'),
    max_triggers_per_day: 2,
    cooldown_minutes: 720,
    vol_regime_gate: null,
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },

  // ── Strategy 3: Low vol breakout (buy in calm markets, tighter regime gate) ──
  {
    strategy_id: 'low_vol_breakout_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'BTC/USD',
    condition_type: 'threshold',
    metric: 'price',
    operator: '>',
    value: 0.01,
    timeframe: '1h',
    action_type: 'size_position',
    action_params: makeContinuation('BTC/USD', 'buy'),
    max_triggers_per_day: 3,
    cooldown_minutes: 480,
    vol_regime_gate: 'normal', // only fires in low or normal vol
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },
  {
    strategy_id: 'low_vol_breakout_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'ETH/USD',
    condition_type: 'threshold',
    metric: 'price',
    operator: '>',
    value: 0.01,
    timeframe: '1h',
    action_type: 'size_position',
    action_params: makeContinuation('ETH/USD', 'buy'),
    max_triggers_per_day: 3,
    cooldown_minutes: 480,
    vol_regime_gate: 'normal',
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },
  {
    strategy_id: 'low_vol_breakout_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'SOL/USD',
    condition_type: 'threshold',
    metric: 'price',
    operator: '>',
    value: 0.01,
    timeframe: '1h',
    action_type: 'size_position',
    action_params: makeContinuation('SOL/USD', 'buy'),
    max_triggers_per_day: 3,
    cooldown_minutes: 480,
    vol_regime_gate: 'normal',
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },

  // ── Strategy 4: High vol mean reversion (buy dips in elevated vol) ──
  {
    strategy_id: 'high_vol_mean_reversion_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'BTC/USD',
    condition_type: 'threshold',
    metric: 'realized_vol',
    operator: '>',
    value: 0.04, // >4% daily realized vol = elevated
    timeframe: '1d',
    action_type: 'size_position',
    action_params: makeContinuation('BTC/USD', 'buy'),
    max_triggers_per_day: 2,
    cooldown_minutes: 720,
    vol_regime_gate: null,
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },
  {
    strategy_id: 'high_vol_mean_reversion_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'SOL/USD',
    condition_type: 'threshold',
    metric: 'realized_vol',
    operator: '>',
    value: 0.05,
    timeframe: '1d',
    action_type: 'size_position',
    action_params: makeContinuation('SOL/USD', 'buy'),
    max_triggers_per_day: 2,
    cooldown_minutes: 720,
    vol_regime_gate: null,
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },

  // ── Strategy 5: BTC/ETH correlation divergence (buy SOL when corr drops) ──
  {
    strategy_id: 'correlation_divergence_v1',
    bot_id: 'risk-bot-1',
    market_type: 'crypto',
    ticker: 'SOL/USD',
    condition_type: 'threshold',
    metric: 'btc_eth_correlation',
    operator: '<',
    value: 0.65,
    timeframe: '1d',
    action_type: 'size_position',
    action_params: makeContinuation('SOL/USD', 'buy'),
    max_triggers_per_day: 1,
    cooldown_minutes: 1440, // once per day
    vol_regime_gate: null,
    status: 'active',
    registered_by: 'seed_smart_conditions',
  },
];

async function run() {
  console.log(`Inserting ${conditions.length} smart conditions...`);
  const { data, error } = await sb.from('watch_conditions').insert(conditions).select('id,ticker,metric,strategy_id');
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log(`\n✅ Inserted ${data?.length} conditions:`);
    for (const d of data ?? []) {
      console.log(`  ${d.strategy_id} | ${d.ticker} | metric=${d.metric}`);
    }
  }

  // Show total active conditions
  const { count } = await sb.from('watch_conditions').select('*', { count: 'exact', head: true }).eq('status', 'active');
  console.log(`\nTotal active conditions: ${count}`);
}

run().catch(console.error);

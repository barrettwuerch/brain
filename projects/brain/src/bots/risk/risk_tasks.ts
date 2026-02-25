// Risk Bot task generator (mocked position data for now)

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function insertTask(row: {
  task_type: string;
  task_input: Record<string, any>;
  tags: string[];
  desk: string;
  bot_id: string;
}) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: row.task_type,
    task_input: row.task_input,
    status: 'queued',
    tags: row.tags,
    agent_role: 'risk',
    desk: row.desk,
    bot_id: row.bot_id,
  });
  if (error) throw error;
}

async function seedPublishRegime() {
  await insertTask({
    task_type: 'publish_regime_state',
    task_input: { tickers: ['BTC/USD', 'ETH/USD'], desk: 'crypto' },
    tags: ['risk', 'crypto', 'priority:1'],
    desk: 'crypto_markets',
    bot_id: 'risk-bot-1',
  });

  await insertTask({
    task_type: 'publish_regime_state',
    task_input: { tickers: [], desk: 'prediction' },
    tags: ['risk', 'prediction_markets', 'priority:1'],
    desk: 'prediction_markets',
    bot_id: 'risk-bot-1',
  });

  console.log('Seeded publish_regime_state tasks.');
}

async function main() {
  // Mock portfolio state
  const positions = [
    { market: 'KXBTC', exposure: 0.12, corr_tag: 'btc' },
    { market: 'KXETH', exposure: 0.10, corr_tag: 'crypto' },
    { market: 'KXBTC', exposure: 0.08, corr_tag: 'btc' },
  ];

  const correlationMatrix = [
    [1, 0.8, 0.9],
    [0.8, 1, 0.7],
    [0.9, 0.7, 1],
  ];

  const drawdownPct = 0.06;
  const tradesSincePeak = 12;

  await insertTask({
    task_type: 'monitor_positions',
    task_input: {
      timestamp: new Date().toISOString(),
      positions,
      correlationMatrix,
      drawdownPct,
      tradesSincePeak,
      unrealizedPnlPct: -0.01,
    },
    tags: ['risk', 'prediction_markets'],
    desk: 'prediction_markets',
    bot_id: 'risk-bot-1',
  });

  await insertTask({
    task_type: 'check_drawdown_limit',
    task_input: {
      drawdownPct,
      equity: 0.94,
      peakEquity: 1.0,
    },
    tags: ['risk', 'prediction_markets'],
    desk: 'prediction_markets',
    bot_id: 'risk-bot-1',
  });

  await insertTask({
    task_type: 'size_position',
    task_input: {
      drawdownPct,
      baseKellySize: 100,
    },
    tags: ['risk', 'prediction_markets'],
    desk: 'prediction_markets',
    bot_id: 'risk-bot-1',
  });

  // Extra: evaluate breakers task so wiring can be exercised.
  await insertTask({
    task_type: 'evaluate_circuit_breakers',
    task_input: {
      snapshot: {
        timestamp: new Date().toISOString(),
        open_positions: positions.length,
        unrealized_pnl: -0.01,
        drawdown_from_peak: drawdownPct,
        drawdown_velocity: drawdownPct / Math.max(tradesSincePeak, 1),
        kelly_multiplier: null,
        enp: null,
        active_breakers: [],
        warnings: [],
      },
    },
    tags: ['risk', 'prediction_markets'],
    desk: 'prediction_markets',
    bot_id: 'risk-bot-1',
  });

  console.log('Seeded risk tasks.');
}

const mode = String(process.argv[2] ?? '').trim();
if (mode === 'publish_regime') {
  seedPublishRegime().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

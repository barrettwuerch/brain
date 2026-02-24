// Risk Bot task generator (mocked position data for now)

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['risk', 'prediction_markets'],
    agent_role: 'risk',
    desk: 'prediction_markets',
    bot_id: 'risk-bot-1',
  });
  if (error) throw error;
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

  await insertTask('monitor_positions', {
    timestamp: new Date().toISOString(),
    positions,
    correlationMatrix,
    drawdownPct,
    tradesSincePeak,
    unrealizedPnlPct: -0.01,
  });

  await insertTask('check_drawdown_limit', {
    drawdownPct,
    equity: 0.94,
    peakEquity: 1.0,
  });

  await insertTask('size_position', {
    drawdownPct,
    baseKellySize: 100,
  });

  // Extra: evaluate breakers task so wiring can be exercised.
  await insertTask('evaluate_circuit_breakers', {
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
  });

  console.log('Seeded risk tasks.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

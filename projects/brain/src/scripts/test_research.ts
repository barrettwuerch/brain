import 'dotenv/config';
import { BrainLoop } from '../agent/loop';

async function test() {
  const loop = new BrainLoop();
  const task = {
    id: 'test-123',
    task_type: 'generate_research_finding',
    agent_role: 'research',
    bot_id: 'research-bot-1',
    desk: 'prediction_markets',
    status: 'queued',
    tags: ['research'],
    task_input: {
      market_ticker: 'KXBTC15M-TEST',
      market_type: 'prediction',
      fetched_at: new Date().toISOString(),
      raw_data: {
        prices_last_30: [22,22,23,23,25,22,25,24,25,25,23,23,25,25,24,24,24,24,25,25,25,24,25,23,26,25,26,26,25,25],
        prices_last_10: [25,24,25,23,26,25,26,26,25,25],
        prices_last_5: [25,26,26,25,25],
        current_vol_1d: 2452,
        avg_vol_30d: 81.73,
        volume_ratio: 30,
        price_range_30: 4,
        price_std_approx: 1.15,
        sample_size: 78,
      },
    },
  };

  try {
    const out = await loop.run(task);
    console.log('RESULT:', JSON.stringify(out, null, 2));
  } catch(e: any) {
    console.error('ERROR:', e?.message ?? e);
    console.error(e?.stack);
  }
}

test();

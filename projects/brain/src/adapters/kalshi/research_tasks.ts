// Research Bot task generator
// Seeds a real discovery task using live Kalshi public data.
// The bot receives raw market data only — no pre-filled description, mechanism, or scores.
// The bot must generate the finding from scratch using the six-question standard.

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

type Trade = {
  created_time: string;
  ticker: string;
  yes_price: number;
  no_price: number;
  count: number;
};

async function fetchJson(url: string): Promise<any> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed ${resp.status} for ${url}`);
  return await resp.json();
}

async function fetchRecentTrades(limit: number = 600): Promise<Trade[]> {
  const url = new URL(KALSHI_BASE + '/markets/trades');
  url.searchParams.set('limit', String(limit));
  const j = await fetchJson(url.toString());
  return (j.trades ?? []) as Trade[];
}

function groupByTicker(trades: Trade[]): Map<string, Trade[]> {
  const m = new Map<string, Trade[]>();
  for (const t of trades) {
    const arr = m.get(t.ticker) ?? [];
    arr.push(t);
    m.set(t.ticker, arr);
  }
  return m;
}

function sortByTimeAsc(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime());
}

function sumCounts(trades: Trade[]): number {
  return trades.reduce((s, t) => s + Number(t.count ?? 0), 0);
}

function computeRawStats(trades: Trade[]): {
  prices_last_30: number[];
  prices_last_10: number[];
  prices_last_5: number[];
  current_vol_1d: number;
  avg_vol_30d: number;
  volume_ratio: number;
  price_range_30: number;
  price_std_approx: number;
  sample_size: number;
} {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const last1d = trades.filter((t) => now - new Date(t.created_time).getTime() <= dayMs);
  const last30d = trades.filter((t) => now - new Date(t.created_time).getTime() <= 30 * dayMs);

  const currentVol = sumCounts(last1d);
  const avgVol = sumCounts(last30d) / 30;

  const prices = trades.map((t) => Number(t.yes_price));
  const last30 = prices.slice(-30);
  const last10 = prices.slice(-10);
  const last5 = prices.slice(-5);

  const priceRange = last30.length ? Math.max(...last30) - Math.min(...last30) : 0;
  const mean = last30.length ? last30.reduce((a, b) => a + b, 0) / last30.length : 0;
  const variance = last30.length ? last30.reduce((s, p) => s + (p - mean) ** 2, 0) / last30.length : 0;
  const std = Math.sqrt(variance);

  return {
    prices_last_30: last30,
    prices_last_10: last10,
    prices_last_5: last5,
    current_vol_1d: currentVol,
    avg_vol_30d: parseFloat(avgVol.toFixed(2)),
    volume_ratio: parseFloat((currentVol / Math.max(avgVol, 1)).toFixed(2)),
    price_range_30: priceRange,
    price_std_approx: parseFloat(std.toFixed(2)),
    sample_size: trades.length,
  };
}

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['research', 'kalshi', 'prediction_markets', 'discovery'],
    agent_role: 'research',
    desk: 'prediction_markets',
    bot_id: 'research-bot-1',
  });
  if (error) throw error;
}

export function seedNextGenHypothesisTask(
  failedFindingId: string,
  marketType: 'prediction' | 'crypto',
): {
  task_type: 'generate_next_generation_hypothesis';
  task_input: { failed_finding_id: string; market_type: 'prediction' | 'crypto' };
  agent_role: 'research';
  bot_id: string;
  desk: string;
} {
  return {
    task_type: 'generate_next_generation_hypothesis',
    task_input: { failed_finding_id: failedFindingId, market_type: marketType },
    agent_role: 'research',
    bot_id: marketType === 'crypto' ? 'crypto-research-bot-1' : 'research-bot-1',
    desk: marketType === 'crypto' ? 'crypto_markets' : 'prediction_markets',
  };
}

async function main() {
  const trades = await fetchRecentTrades(600);
  const byTicker = groupByTicker(trades);

  // Pick top 3 most-traded markets for diversity
  const candidates = Array.from(byTicker.entries())
    .map(([ticker, ts]) => ({ ticker, trades: sortByTimeAsc(ts) }))
    .filter((x) => x.trades.length >= 20);

  if (!candidates.length) throw new Error('No candidate markets with enough recent trades.');
  candidates.sort((a, b) => b.trades.length - a.trades.length);

  // Seed one discovery task for the top market
  const chosen = candidates[0];
  const stats = computeRawStats(chosen.trades);

  await insertTask('generate_research_finding', {
    market_ticker: chosen.ticker,
    market_type: 'prediction',
    fetched_at: new Date().toISOString(),
    raw_data: stats,
  });

  console.log('Inserted generate_research_finding task for', chosen.ticker, {
    sample_size: stats.sample_size,
    volume_ratio: stats.volume_ratio,
    price_range: stats.price_range_30,
  });
}

if (process.argv[1]?.endsWith('research_tasks.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

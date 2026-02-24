// Trading Level 1 task generator (Phase 6)
// Uses Kalshi public market data (no auth) to generate gradeable research tasks.

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

type Trade = {
  created_time: string;
  ticker: string;
  yes_price: number;
  no_price: number;
  count: number;
  taker_side?: string;
};

async function fetchJson(url: string): Promise<any> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed ${resp.status} for ${url}`);
  return await resp.json();
}

async function fetchRecentTrades(limit: number = 200): Promise<Trade[]> {
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

function trendYes(prices: number[]): 'yes' | 'no' | 'flat' {
  if (prices.length < 2) return 'flat';
  const first = prices[0];
  const last = prices[prices.length - 1];
  const diff = last - first;
  const eps = 1; // 1 cent
  if (diff > eps) return 'yes';
  if (diff < -eps) return 'no';
  return 'flat';
}

function momentum(prices: number[]): 'strong_yes' | 'weak_yes' | 'neutral' | 'weak_no' | 'strong_no' {
  if (prices.length < 2) return 'neutral';
  const first = prices[0];
  const last = prices[prices.length - 1];
  const diff = last - first;
  const abs = Math.abs(diff);

  // cents thresholds
  if (abs < 1) return 'neutral';
  if (diff > 0) return abs >= 5 ? 'strong_yes' : 'weak_yes';
  return abs >= 5 ? 'strong_no' : 'weak_no';
}

function sumCounts(trades: Trade[]): number {
  return trades.reduce((s, t) => s + Number(t.count ?? 0), 0);
}

function volumeRatio(trades: Trade[]): { current_volume: number; avg_volume: number; ratio: number } {
  // Approximate "current" as last 24h and "avg" as (last 30 days)/30 using available trades.
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const last1d = trades.filter((t) => now - new Date(t.created_time).getTime() <= dayMs);
  const last30d = trades.filter((t) => now - new Date(t.created_time).getTime() <= 30 * dayMs);

  const current_volume = sumCounts(last1d);
  const avg_volume = sumCounts(last30d) / 30;
  const ratio = avg_volume > 0 ? current_volume / avg_volume : 0;

  return { current_volume, avg_volume, ratio };
}

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['trading', 'kalshi', 'level1'],
    agent_role: 'research',
    desk: 'prediction_markets',
    bot_id: 'research-bot-1',
  });
  if (error) throw error;
}

async function main() {
  // Strategy: pull a batch of recent trades across tickers, pick a ticker with enough trades,
  // and build all 3 tasks from a single frozen snapshot of price points.
  const trades = await fetchRecentTrades(400);
  const byTicker = groupByTicker(trades);

  const candidates = Array.from(byTicker.entries())
    .map(([ticker, ts]) => ({ ticker, trades: sortByTimeAsc(ts) }))
    .filter((x) => x.trades.length >= 15);

  if (!candidates.length) throw new Error('No candidate market tickers with enough recent trades to build tasks.');

  // Pick the most active ticker in this sample.
  candidates.sort((a, b) => b.trades.length - a.trades.length);
  const chosen = candidates[0];

  const yesPricesAsc = chosen.trades.map((t) => Number(t.yes_price));
  const last10 = yesPricesAsc.slice(-10);
  const last5 = yesPricesAsc.slice(-5);

  const gtTrend = trendYes(last10);
  const gtMomentum = momentum(last5);

  const vol = volumeRatio(chosen.trades);
  const gtAnomaly = vol.ratio > 2.0;

  const snapshot = {
    source: 'kalshi_public_trades',
    ticker: chosen.ticker,
    fetched_at: new Date().toISOString(),
    trade_count_in_sample: chosen.trades.length,
  };

  await insertTask('market_trend_scan', {
    snapshot,
    market: { ticker: chosen.ticker },
    price_points_yes: last10,
    question: 'Is this prediction market trending toward YES or NO based on the last 10 price points?',
    expected_answer: { trend: gtTrend },
  });

  await insertTask('volume_anomaly_detect', {
    snapshot,
    market: { ticker: chosen.ticker },
    current_volume: vol.current_volume,
    avg_volume: vol.avg_volume,
    question: 'Does this market have unusually high volume compared to its 30-day average?',
    expected_answer: { anomaly: gtAnomaly, ratio: vol.ratio },
  });

  await insertTask('price_momentum_classify', {
    snapshot,
    market: { ticker: chosen.ticker },
    price_points_yes: last5,
    question: 'What is the momentum classification for this market over the last 5 price points?',
    expected_answer: { momentum: gtMomentum },
  });

  console.log('Inserted 3 Trading Level 1 tasks into tasks queue.', { ticker: chosen.ticker });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

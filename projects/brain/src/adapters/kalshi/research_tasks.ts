// Research Bot task generator
// Seeds 3 research tasks per run using live Kalshi public data and frozen snapshots.

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

async function fetchRecentTrades(limit: number = 400): Promise<Trade[]> {
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

function volumeRatio(trades: Trade[]): { currentVol: number; avgVol: number; ratio: number } {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const last1d = trades.filter((t) => now - new Date(t.created_time).getTime() <= dayMs);
  const last30d = trades.filter((t) => now - new Date(t.created_time).getTime() <= 30 * dayMs);

  const currentVol = sumCounts(last1d);
  const avgVol = sumCounts(last30d) / 30;
  const ratio = currentVol / Math.max(avgVol, 1);

  return { currentVol, avgVol, ratio };
}

// Ground truth uses the same pure functions the bot uses in ACT.
import { classifyMomentum, detectVolumeAnomaly, scanMarketTrend } from '../../bots/research/research_compute';

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['research', 'kalshi', 'prediction_markets'],
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

  const candidates = Array.from(byTicker.entries())
    .map(([ticker, ts]) => ({ ticker, trades: sortByTimeAsc(ts) }))
    .filter((x) => x.trades.length >= 15);

  if (!candidates.length) throw new Error('No candidate markets with enough recent trades.');
  candidates.sort((a, b) => b.trades.length - a.trades.length);
  const chosen = candidates[0];

  const yesPricesAsc = chosen.trades.map((t) => Number(t.yes_price));
  const last10 = yesPricesAsc.slice(-10);
  const last5 = yesPricesAsc.slice(-5);

  const vol = volumeRatio(chosen.trades);

  // Shared finding narrative (six questions) — minimal but complete.
  const narrative = {
    edge_type: 'liquidity',
    description: `Short-horizon price movement signal on ${chosen.ticker} based on recent trade prices (frozen snapshot).`,
    mechanism: 'Liquidity + noise traders can temporarily push implied probability; short-horizon continuation/reversion may emerge.',
    failure_conditions: 'Fails in regime shifts, news shocks, or when spread widens/volume collapses.',
    sample_size: chosen.trades.length,
    base_rate: 0.5,
    observed_rate: null,
    lift: null,
    out_of_sample: false,
    notes: 'Generated from Kalshi public trades endpoint; snapshot is deterministic for grading.',
    rqs_components: {
      statistical_rigor: 0.4,
      mechanism_clarity: 0.7,
      novelty: 0.4,
      cost_adjusted_edge: 0.4,
    },
    draft_recommendation: 'investigate_further',
  };

  await insertTask('market_trend_scan', {
    snapshot: {
      source: 'kalshi_public_trades',
      ticker: chosen.ticker,
      fetched_at: new Date().toISOString(),
      trade_count_in_sample: chosen.trades.length,
    },
    market_ticker: chosen.ticker,
    prices: last10,
    question: 'Is this prediction market trending toward YES or NO based on the last 10 price points?',
    expected_answer: scanMarketTrend(last10),
    ...narrative,
  });

  await insertTask('volume_anomaly_detect', {
    snapshot: {
      source: 'kalshi_public_trades',
      ticker: chosen.ticker,
      fetched_at: new Date().toISOString(),
      trade_count_in_sample: chosen.trades.length,
    },
    market_ticker: chosen.ticker,
    currentVol: vol.currentVol,
    avgVol: vol.avgVol,
    question: 'Does this market have unusually high volume compared to its 30-day average?',
    expected_answer: detectVolumeAnomaly(vol.currentVol, vol.avgVol),
    ...narrative,
  });

  await insertTask('price_momentum_classify', {
    snapshot: {
      source: 'kalshi_public_trades',
      ticker: chosen.ticker,
      fetched_at: new Date().toISOString(),
      trade_count_in_sample: chosen.trades.length,
    },
    market_ticker: chosen.ticker,
    prices: last5,
    question: 'What is the momentum classification for this market over the last 5 price points?',
    expected_answer: classifyMomentum(last5),
    ...narrative,
  });

  console.log('Inserted 3 research tasks into tasks queue.', { ticker: chosen.ticker });
}

if (process.argv[1]?.endsWith('research_tasks.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

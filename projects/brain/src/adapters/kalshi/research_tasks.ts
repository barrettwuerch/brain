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


// ── Monte Carlo BTC Mispricing Scanner ───────────────────────────────────────
// Fetches active KXBTC contracts, computes GBM model price vs market price,
// submits discrepancies > 0.06 as research finding candidates.
// NOTE: GBM is an approximation — fat tails and regime jumps are not modeled.
// Brier score tracking will measure calibration drift empirically over time.

async function fetchBtcLivePrice(): Promise<{ price: number; realized_vol: number }> {
  const url = 'https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC%2FUSD&timeframe=4H&limit=30';
  const resp = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY ?? '',
    },
  });
  if (!resp.ok) throw new Error(`Alpaca bars fetch failed ${resp.status}`);
  const j = await resp.json() as any;
  const bars = j?.bars?.['BTC/USD'] ?? [];
  if (bars.length < 2) throw new Error('Not enough BTC bars for vol estimate');

  const closes = bars.map((b: any) => Number(b.c));
  const latest = closes[closes.length - 1];

  // Realized vol: annualized std of log returns
  const logReturns = [];
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / logReturns.length;
  // 4h bars → annualize: sqrt(365 * 6) = sqrt(2190)
  const realizedVol = Math.sqrt(variance * 2190);

  return { price: latest, realized_vol: parseFloat(realizedVol.toFixed(4)) };
}

async function fetchActiveKxbtcContracts(): Promise<any[]> {
  const url = new URL(KALSHI_BASE + '/markets');
  url.searchParams.set('series_ticker', 'KXBTC');
  url.searchParams.set('status', 'open');
  url.searchParams.set('limit', '50');
  const j = await fetchJson(url.toString());
  return (j.markets ?? []) as any[];
}

// Standard normal CDF (Abramowitz & Stegun approximation)
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422820 * Math.exp(-x * x / 2);
  const poly = t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  const cdf = 1 - d * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

// Black-Scholes digital call: P(S_T > K) under risk-neutral measure
function modelPrice(S0: number, K: number, sigma: number, T: number, mu: number = 0): number {
  if (T <= 0 || sigma <= 0 || S0 <= 0 || K <= 0) return 0.5;
  const d2 = (Math.log(S0 / K) + (mu - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normalCDF(d2);
}

export async function seedBtcMispricingScan(): Promise<void> {
  const TRANSACTION_COST = 0.02;
  const DISCREPANCY_THRESHOLD = 0.06;

  let btcData: { price: number; realized_vol: number };
  try {
    btcData = await fetchBtcLivePrice();
  } catch (e: any) {
    console.error('[MC] Failed to fetch BTC price/vol:', e?.message);
    return;
  }

  let contracts: any[];
  try {
    contracts = await fetchActiveKxbtcContracts();
  } catch (e: any) {
    console.error('[MC] Failed to fetch KXBTC contracts:', e?.message);
    return;
  }

  console.log(`[MC] BTC price=$${btcData.price.toFixed(0)} vol=${(btcData.realized_vol * 100).toFixed(1)}% contracts=${contracts.length}`);

  const candidates: any[] = [];

  for (const contract of contracts) {
    const ticker = String(contract.ticker ?? '');
    const marketPrice = Number(contract.yes_ask ?? contract.yes_bid ?? 0) / 100; // cents → probability
    if (marketPrice <= 0 || marketPrice >= 1) continue;

    // Parse threshold from ticker e.g. KXBTC15M-26MAR271730-85000
    const parts = ticker.split('-');
    const thresholdStr = parts[parts.length - 1];
    const K = parseFloat(thresholdStr);
    if (!K || isNaN(K)) continue;

    // Parse resolution time from ticker
    const closeTime = contract.close_time ? new Date(contract.close_time).getTime() : null;
    if (!closeTime) continue;
    const T = Math.max(0, (closeTime - Date.now()) / (1000 * 60 * 60 * 24 * 365)); // years

    const model = modelPrice(btcData.price, K, btcData.realized_vol, T);
    const discrepancy = model - marketPrice;
    const absDiscrepancy = Math.abs(discrepancy);

    if (absDiscrepancy > DISCREPANCY_THRESHOLD + TRANSACTION_COST) {
      candidates.push({
        ticker,
        K,
        T_years: parseFloat(T.toFixed(6)),
        T_hours: parseFloat((T * 365 * 24).toFixed(2)),
        market_price: parseFloat(marketPrice.toFixed(4)),
        model_price: parseFloat(model.toFixed(4)),
        discrepancy: parseFloat(discrepancy.toFixed(4)),
        direction: discrepancy > 0 ? 'model_above_market' : 'model_below_market',
        btc_price: btcData.price,
        realized_vol: btcData.realized_vol,
        yes_ask: contract.yes_ask,
        yes_bid: contract.yes_bid,
        volume: contract.volume,
      });
    }
  }

  console.log(`[MC] Found ${candidates.length} mispriced contracts (threshold=${DISCREPANCY_THRESHOLD + TRANSACTION_COST})`);

  if (candidates.length === 0) {
    console.log('[MC] No mispriced contracts found — no task inserted');
    return;
  }

  // Insert one research task with all candidates — bot picks the best one
  await insertTask('generate_research_finding', {
    market_ticker: candidates[0].ticker,
    market_type: 'prediction',
    scan_type: 'monte_carlo_mispricing',
    fetched_at: new Date().toISOString(),
    btc_snapshot: { price: btcData.price, realized_vol: btcData.realized_vol },
    candidates: candidates.slice(0, 5), // top 5 by discrepancy
    raw_data: {
      sample_size: contracts.length,
      mispriced_count: candidates.length,
      largest_discrepancy: Math.max(...candidates.map(c => Math.abs(c.discrepancy))),
      model_note: 'GBM approximation — fat tails and regime jumps not modeled. Treat as approximation until 20+ contracts resolved.',
    },
  });

  console.log(`[MC] Inserted generate_research_finding task — top candidate: ${candidates[0].ticker} discrepancy=${candidates[0].discrepancy.toFixed(3)}`);
}

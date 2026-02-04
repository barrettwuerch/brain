#!/usr/bin/env node
/**
 * diagnose_price_band_depth.mjs
 *
 * For markets in a close-time window whose YES_ASK or NO_ASK is in a target band,
 * fetch orderbook(depth=1) to measure whether the price is real (tight) or phantom (no bid / huge spread).
 *
 * Outputs one-screen summary stats.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { KalshiClient } from '../lib/kalshi_client.mjs';
import { loadEnvFile } from '../lib/util.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function to01(priceCentsOrNull) {
  if (priceCentsOrNull == null) return null;
  const n = Number(priceCentsOrNull);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

function bestLevel(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const [p, q] = levels[0];
  const price = Number(p);
  const qty = Number(q);
  if (!(Number.isFinite(price) && Number.isFinite(qty))) return null;
  return { price, qty };
}

function computeSpreads(orderbook) {
  const yesBid = bestLevel(orderbook?.orderbook?.yes); // bid in cents
  const noBid = bestLevel(orderbook?.orderbook?.no);

  const yesAsk = noBid ? (100 - noBid.price) : null;
  const noAsk = yesBid ? (100 - yesBid.price) : null;

  const yesBidC = yesBid?.price ?? null;
  const noBidC = noBid?.price ?? null;

  const yesAskC = yesAsk;
  const noAskC = noAsk;

  const yesSpreadC = (yesBidC != null && yesAskC != null) ? (yesAskC - yesBidC) : null;
  const noSpreadC  = (noBidC  != null && noAskC  != null) ? (noAskC  - noBidC ) : null;

  return {
    yesBidC, yesBidQty: yesBid?.qty ?? null,
    yesAskC, yesAskQty: noBid?.qty ?? null,
    yesSpreadC,

    noBidC, noBidQty: noBid?.qty ?? null,
    noAskC, noAskQty: yesBid?.qty ?? null,
    noSpreadC,
  };
}

async function fetchMarketsWindow({ client, minClose, maxClose, limit = 1000, maxPages = 30, extra = {} }) {
  let cursor = null;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const params = { status: 'open', limit: String(limit), min_close_time: minClose, max_close_time: maxClose, ...extra };
    if (cursor) params.cursor = cursor;

    let resp;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        resp = await client.getMarkets(params);
        break;
      } catch (e) {
        if (e?.status === 429) { await sleep(250 * Math.pow(2, attempt)); continue; }
        throw e;
      }
    }
    if (!resp) throw new Error('getMarkets failed after retries');

    const batch = resp.markets || [];
    out.push(...batch);

    cursor = resp.cursor || resp.next_cursor || resp.nextCursor || null;
    if (!cursor || batch.length === 0) break;
    await sleep(100);
  }
  return out;
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const x = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  if (lo === hi) return sorted[lo];
  const w = x - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function isWeatherSeriesTicker(t) {
  const s = String(t || '');
  return /^(KXHIGH|KXLOW|KXRAIN|KXSNOW|KXWIND)/.test(s);
}

function isWeatherMarket(m) {
  const t = String(m?.ticker || '');
  return /^(KXHIGH|KXLOW|KXRAIN|KXSNOW|KXWIND)/.test(t);
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/augur_v2/config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const envPath = process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env');
  const env = loadEnvFile(envPath);
  const keyId = process.env.KALSHI_API_KEY || env.KALSHI_API_KEY;
  const pkPath = process.env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_PRIVATE_KEY_PATH;
  const baseUrl = (process.env.KALSHI_BASE_URL || env.KALSHI_BASE_URL || cfg.baseUrl).replace(/\/$/, '');
  if (!keyId || !pkPath) throw new Error('Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH');
  const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

  const client = new KalshiClient({ baseUrl, keyId, privateKeyPem });

  const minDays = Number(arg('--minDays', String(cfg.selection.minDaysToSettlement ?? 2)));
  const maxDays = Number(arg('--maxDays', String(cfg.selection.maxDaysToSettlement ?? 21)));
  const lo = Number(arg('--lo', String(cfg.selection.priceFloor ?? 0.93)));
  const hi = Number(arg('--hi', String(cfg.selection.priceCeiling ?? 0.99)));
  const sampleN = Number(arg('--sample', '120'));

  const weatherHours = Number(arg('--weatherHours', '48'));
  const weatherMaxPages = Number(arg('--weatherPages', '10'));

  const minClose = new Date(Date.now() + minDays * 86400000).toISOString();
  const maxClose = new Date(Date.now() + maxDays * 86400000).toISOString();

  const markets = await fetchMarketsWindow({ client, minClose, maxClose, limit: 1000, maxPages: 30 });

  // Identify hits by listed ask.
  const hits = [];
  for (const m of markets) {
    const yesAsk = to01(m.yes_ask);
    const noAsk = to01(m.no_ask);
    const yesOk = (yesAsk != null && yesAsk >= lo && yesAsk <= hi);
    const noOk = (noAsk != null && noAsk >= lo && noAsk <= hi);
    if (yesOk || noOk) {
      hits.push({
        ticker: m.ticker,
        close_time: m.close_time,
        series_hint: String(m.event_ticker || '').split('-')[0] || 'UNK',
        yesAsk, noAsk,
        volume: Number(m.volume || 0),
      });
    }
  }

  // Sample deterministically (first N). These are already the rare ones.
  const sample = hits.slice(0, sampleN);

  let nOB = 0;
  let phantom = 0;

  const spreadBuckets = { le1: 0, le2: 0, le5: 0, le10: 0, gt10: 0, unknown: 0 };
  const bidQtyBuckets = { ge50: 0, ge10: 0, ge1: 0, zero: 0, unknown: 0 };

  let tightCount = 0;
  let bidPresent = 0;

  for (const h of sample) {
    let ob;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        ob = await client.getOrderbook(h.ticker, 1);
        break;
      } catch (e) {
        if (e?.status === 429) { await sleep(250 * Math.pow(2, attempt)); continue; }
        ob = null;
        break;
      }
    }
    await sleep(30);
    if (!ob) continue;
    nOB++;

    const s = computeSpreads(ob);

    // Decide which side we're in-band on listed book.
    const side = (h.noAsk != null && h.noAsk >= lo && h.noAsk <= hi) ? 'NO'
      : (h.yesAsk != null && h.yesAsk >= lo && h.yesAsk <= hi) ? 'YES'
      : null;

    const spreadC = (side === 'NO') ? s.noSpreadC : (side === 'YES') ? s.yesSpreadC : null;
    const bidC = (side === 'NO') ? s.noBidC : (side === 'YES') ? s.yesBidC : null;
    const bidQty = (side === 'NO') ? s.noBidQty : (side === 'YES') ? s.yesBidQty : null;

    if (bidC == null || bidQty == null) {
      phantom++;
      spreadBuckets.unknown++;
      bidQtyBuckets.unknown++;
      continue;
    }

    if (bidQty <= 0) bidQtyBuckets.zero++;
    else if (bidQty >= 50) bidQtyBuckets.ge50++;
    else if (bidQty >= 10) bidQtyBuckets.ge10++;
    else bidQtyBuckets.ge1++;

    bidPresent++;

    if (spreadC == null) {
      spreadBuckets.unknown++;
    } else if (spreadC <= 1) spreadBuckets.le1++;
    else if (spreadC <= 2) spreadBuckets.le2++;
    else if (spreadC <= 5) spreadBuckets.le5++;
    else if (spreadC <= 10) spreadBuckets.le10++;
    else spreadBuckets.gt10++;

    if (spreadC != null && spreadC <= 2 && bidQty >= 10) tightCount++;
  }

  console.log(`DEPTH DIAGNOSTIC | window days=[${minDays},${maxDays}] close=[${minClose}..${maxClose}] band=[${lo.toFixed(2)},${hi.toFixed(2)}]`);
  console.log(`markets_scanned=${markets.length} hits=${hits.length} sampled=${sample.length} orderbooks_fetched=${nOB}`);
  console.log(`phantom_or_no_bid=${phantom}`);
  console.log('spread buckets (cents):', spreadBuckets);
  console.log('bidQty buckets (contracts at best bid for in-band side):', bidQtyBuckets);
  console.log(`tight (spread<=2c and bidQty>=10): ${tightCount}`);

  // Print a few example tickers for manual spot-checking.
  console.log('\nSample hit series (top 10):');
  const topSeries = new Map();
  for (const h of hits) topSeries.set(h.series_hint, (topSeries.get(h.series_hint) || 0) + 1);
  const top = [...topSeries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [s, c] of top) console.log(`${String(c).padStart(4)}  ${s}`);

  console.log('\nFirst 10 hit tickers:');
  for (const h of hits.slice(0, 10)) console.log(`${h.ticker} yesAsk=${h.yesAsk} noAsk=${h.noAsk} vol=${h.volume}`);

  // --- Weather sub-diagnostic: 0-48h close window, distribution of near-certain side ask ---
  // Note: global close-time window queries don't seem to surface weather tickers reliably,
  // so we explicitly discover weather series and pull markets by series_ticker.
  const wMinClose = new Date(Date.now()).toISOString();
  const wMaxClose = new Date(Date.now() + weatherHours * 3600_000).toISOString();

  // Discover weather series tickers
  let seriesCursor = null;
  const weatherSeries = [];
  for (let page = 0; page < 30; page++) {
    const params = { limit: '500' };
    if (seriesCursor) params.cursor = seriesCursor;
    let resp;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { resp = await client.getSeries(params); break; }
      catch (e) { if (e?.status === 429) { await sleep(250 * Math.pow(2, attempt)); continue; } throw e; }
    }
    const batch = resp?.series || [];
    for (const s of batch) {
      if (isWeatherSeriesTicker(s?.ticker)) weatherSeries.push(s.ticker);
    }
    seriesCursor = resp?.cursor || resp?.next_cursor || resp?.nextCursor || null;
    if (!seriesCursor || batch.length === 0) break;
    await sleep(80);
  }

  const seriesToPull = [...new Set(weatherSeries)].slice(0, 120);

  const wx = [];
  let weatherMarketsScanned = 0;
  for (const st of seriesToPull) {
    const ms = await fetchMarketsWindow({
      client,
      minClose: wMinClose,
      maxClose: wMaxClose,
      limit: 200,
      maxPages: 10,
      extra: { series_ticker: st },
    });
    weatherMarketsScanned += ms.length;
    for (const m of ms) {
      if (isWeatherMarket(m)) wx.push(m);
    }
    await sleep(60);
  }

  const bestSideAsks = [];
  let ge93 = 0, ge95 = 0, ge97 = 0, ge99 = 0;
  for (const m of wx) {
    const ya = to01(m.yes_ask);
    const na = to01(m.no_ask);
    const best = Math.max(ya ?? 0, na ?? 0);
    if (!Number.isFinite(best) || best <= 0) continue;
    bestSideAsks.push(best);
    if (best >= 0.93) ge93++;
    if (best >= 0.95) ge95++;
    if (best >= 0.97) ge97++;
    if (best >= 0.99) ge99++;
  }
  bestSideAsks.sort((a, b) => a - b);

  console.log(`\nWEATHER PRICE DISTRIBUTION | close window=[now..+${weatherHours}h] weather_markets_scanned=${weatherMarketsScanned} weather_markets=${wx.length}`);
  console.log(`bestSideAsk count=${bestSideAsks.length} >=0.93:${ge93} >=0.95:${ge95} >=0.97:${ge97} >=0.99:${ge99}`);
  console.log(`bestSideAsk percentiles: p50=${pct(bestSideAsks,0.50)?.toFixed?.(3)} p75=${pct(bestSideAsks,0.75)?.toFixed?.(3)} p90=${pct(bestSideAsks,0.90)?.toFixed?.(3)} p95=${pct(bestSideAsks,0.95)?.toFixed?.(3)} p99=${pct(bestSideAsks,0.99)?.toFixed?.(3)}`);
}

main().catch((e) => {
  console.error('DIAG_FATAL:', e?.message || e);
  if (e?.status) console.error('status:', e.status);
  if (e?.data) console.error('data:', JSON.stringify(e.data, null, 2));
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Project Augur v2 — scanner (Phase 0)
 *
 * Live scan of Kalshi markets to identify high-probability bond-harvesting candidates.
 * No orders.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { KalshiClient } from './lib/kalshi_client.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
import { loadEnvFile, jsonlWriter, clamp, toDays, annualizedYield } from './lib/util.mjs';
import { compileRules, matchAny } from './lib/filters.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function killSwitchOn(file) {
  try { return !!(file && fs.existsSync(file)); } catch { return false; }
}

function parsePrice01(x) {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  // Kalshi often uses cents 0-100; accept either
  if (n > 1.5) return n / 100;
  return n;
}

function bestLevel(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const [p, q] = levels[0];
  const price = Number(p);
  const qty = Number(q);
  if (!(Number.isFinite(price) && Number.isFinite(qty))) return null;
  return { price, qty };
}

function bestAsks(ob) {
  // Kalshi orderbook returns bids for YES and NO.
  // Implied ask(YES) = 100 - bestBid(NO)
  // Implied ask(NO)  = 100 - bestBid(YES)
  const yesB = bestLevel(ob?.orderbook?.yes);
  const noB = bestLevel(ob?.orderbook?.no);

  const yesAsk = (noB && Number.isFinite(noB.price)) ? (100 - noB.price) : null;
  const noAsk = (yesB && Number.isFinite(yesB.price)) ? (100 - yesB.price) : null;

  return {
    yes: (yesAsk != null && noB) ? { price: yesAsk / 100, qty: noB.qty } : null,
    no: (noAsk != null && yesB) ? { price: noAsk / 100, qty: yesB.qty } : null,
  };
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
  const log = jsonlWriter(cfg.logging.dir, 'augur_scan');

  const allow = compileRules(cfg.categories?.allow || []);
  const deny = compileRules(cfg.categories?.deny || []);

  console.log(`Augur v2 scanner | baseUrl=${baseUrl} | log=${log.file}`);

  // One-shot scan for now (Phase 0).
  if (killSwitchOn(cfg.risk.killSwitchFile)) {
    console.log('KILL SWITCH ON; exiting');
    process.exit(0);
  }

  const sel = cfg.selection;
  const limit = sel.limit || 500;

  async function fetchPaged(kind, fn, paramsBase, outArr, maxPages = 50) {
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
      const params = { ...paramsBase };
      if (cursor) params.cursor = cursor;

      let resp;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          resp = await fn(params);
          break;
        } catch (e) {
          if (e?.status === 429) {
            const backoff = 250 * Math.pow(2, attempt);
            await sleep(backoff);
            continue;
          }
          throw e;
        }
      }
      if (!resp) throw new Error(`fetchPaged failed after retries (${kind})`);

      const batch = resp?.[kind] || [];
      if (kind === 'markets' && paramsBase.series_ticker) {
        for (const m of batch) m.__series_ticker = paramsBase.series_ticker;
      }
      outArr.push(...batch);

      cursor = resp?.cursor || resp?.next_cursor || resp?.nextCursor || null;
      if (!cursor || batch.length === 0) break;
      await sleep(80);
    }
  }

  function looksLikeWeatherSeries(s, dcfg) {
    const t = String(s?.ticker || '');
    const title = String(s?.title || '').toLowerCase();
    if ((dcfg.weatherTickerPrefixes || []).some(p => t.startsWith(p))) return true;
    return (dcfg.weatherTitleKeywords || []).some(k => title.includes(String(k).toLowerCase()));
  }

  function looksLikeEconSeries(s, dcfg) {
    const t = String(s?.ticker || '');
    const title = String(s?.title || '').toLowerCase();
    if ((dcfg.econTickerPrefixes || []).some(p => t.startsWith(p))) return true;
    return (dcfg.econTitleKeywords || []).some(k => title.includes(String(k).toLowerCase()));
  }

  // --- Series discovery ---
  let seriesTickers = [];
  const seriesCategoryByTicker = new Map();
  const dcfg = cfg.discovery || {};
  if (dcfg.enabled) {
    const series = [];
    await fetchPaged('series', (p) => client.getSeries(p), { limit: String(dcfg.seriesPageLimit || 500) }, series, Math.ceil((dcfg.maxSeriesScan || 8000) / (dcfg.seriesPageLimit || 500)) + 2);

    const weather = [];
    const econ = [];
    for (const s of series) {
      if (looksLikeWeatherSeries(s, dcfg)) { weather.push(s.ticker); seriesCategoryByTicker.set(s.ticker, 'weather'); }
      else if (looksLikeEconSeries(s, dcfg)) { econ.push(s.ticker); seriesCategoryByTicker.set(s.ticker, 'econ'); }
    }

    seriesTickers = [...new Set([...weather, ...econ])].slice(0, dcfg.maxSeriesUse || 500);
    log.write({ t: Date.now(), type: 'discovery', seriesScanned: series.length, weatherSeries: weather.length, econSeries: econ.length, seriesUsed: seriesTickers.length });
  }

  // --- Fetch markets ---
  const markets = [];

  const minClose = new Date(Date.now() + sel.minDaysToSettlement * 86400000).toISOString();
  const maxClose = new Date(Date.now() + sel.maxDaysToSettlement * 86400000).toISOString();

  // Primary: global fetch in close-time window (much faster than per-series).
  await fetchPaged(
    'markets',
    (p) => client.getMarkets(p),
    { status: sel.status || 'open', limit: String(limit), min_close_time: minClose, max_close_time: maxClose },
    markets,
    50,
  );

  log.write({ t: Date.now(), type: 'market_fetch', mode: 'close_time_window', minClose, maxClose, markets: markets.length });

  const tNow = Date.now();
  const candidates = [];

  const funnel = {
    totalMarkets: markets.length,
    deny: 0,
    notAllowed: 0,
    days: 0,
    volume: 0,
    orderbookError: 0,
    noAsk: 0,
    price: 0,
    askQty: 0,
    passedTier12: 0,
    candidates: 0,
  };

  for (const mkt of markets) {
    const ticker = mkt?.ticker;
    if (!ticker) continue;

    const title = String(mkt?.title || '');
    const series = String(mkt?.series_ticker || mkt?.__series_ticker || '');

    // Deny first
    const denyHit = matchAny(mkt, deny);
    if (denyHit.ok) {
      funnel.deny++;
      log.write({ t: Date.now(), type: 'reject', ticker, title, series, reason: 'deny', rule: denyHit.rule });
      continue;
    }

    // Allow
    let allowHit = null;
    // We can only infer category from discovery if the market provides series_ticker (often missing).
    const inferredCat = series ? seriesCategoryByTicker.get(series) : null;
    if (inferredCat) allowHit = { ok: true, rule: inferredCat, why: 'series_discovery' };
    else allowHit = matchAny(mkt, allow);

    if (!allowHit.ok) {
      funnel.notAllowed++;
      log.write({ t: Date.now(), type: 'reject', ticker, title, series, reason: 'not_allowed' });
      continue;
    }

    // Time to settlement
    const closeMs = Date.parse(mkt?.close_time || mkt?.closeTime || mkt?.settlement_time || mkt?.settlementTime || '');
    const days = Number.isFinite(closeMs) ? toDays(closeMs - tNow) : null;
    if (!(days != null && days >= sel.minDaysToSettlement && days <= sel.maxDaysToSettlement)) {
      funnel.days++;
      log.write({ t: Date.now(), type: 'reject', ticker, title, series, reason: 'days_to_settlement', days });
      continue;
    }

    // Volume (USD) if present
    const vol = Number(mkt?.volume || mkt?.volume_usd || mkt?.volumeUsd || 0);
    if (Number.isFinite(sel.minVolumeUsd) && vol < sel.minVolumeUsd) {
      funnel.volume++;
      log.write({ t: Date.now(), type: 'reject', ticker, title, series, reason: 'volume', vol });
      continue;
    }

    // Orderbook
    let ob;
    try {
      ob = await client.getOrderbook(ticker, cfg.orderbookDepth || 1);
      await sleep(30);
    } catch (e) {
      funnel.orderbookError++;
      log.write({ t: Date.now(), type: 'error', where: 'orderbook', ticker, message: String(e?.message || e) });
      continue;
    }

    const asks = bestAsks(ob);
    if (!asks.yes && !asks.no) {
      funnel.noAsk++;
      log.write({ t: Date.now(), type: 'reject', ticker, title, series, reason: 'no_ask' });
      continue;
    }

    funnel.passedTier12++;

    for (const side of ['yes', 'no']) {
      const ask = asks[side];
      if (!ask) continue;

      const price = ask.price;
      if (price < sel.priceFloor || price > sel.priceCeiling) { funnel.price++; continue; }
      if (ask.qty < sel.minBestAskQty) { funnel.askQty++; continue; }

      const ay = annualizedYield({ price, days });

      candidates.push({
        ticker,
        side: side.toUpperCase(),
        title,
        series,
        allowRule: allowHit.rule,
        daysToSettlement: Number(days.toFixed(3)),
        askPrice: Number(price.toFixed(4)),
        askQty: ask.qty,
        volumeUsd: vol,
        annualizedYield: ay == null ? null : Number(ay.toFixed(4)),
      });
    }
  }

  candidates.sort((a, b) => (b.annualizedYield ?? -1) - (a.annualizedYield ?? -1));
  funnel.candidates = candidates.length;

  log.write({ t: Date.now(), type: 'scan_funnel', ...funnel });
  log.write({ t: Date.now(), type: 'scan_summary', total: markets.length, candidates: candidates.length, top: candidates.slice(0, 50) });

  const topN = cfg.logging.consoleTopN || 25;
  console.log(`\nTop ${topN} candidates:`);
  for (const c of candidates.slice(0, topN)) {
    console.log(`${c.annualizedYield?.toFixed?.(3) ?? 'n/a'}  ${c.side} price=${c.askPrice.toFixed(3)}  days=${c.daysToSettlement}  qty=${c.askQty}  vol=${c.volumeUsd}  ${c.ticker}  [${c.allowRule}]  ${c.title.slice(0, 90)}`);
  }

  console.log(`\nScan complete: markets=${markets.length} candidates=${candidates.length} log=${log.file}`);
}

main().catch((e) => {
  console.error('AUGUR_SCAN_FATAL:', e?.message || e);
  process.exit(1);
});

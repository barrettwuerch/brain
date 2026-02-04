#!/usr/bin/env node
/**
 * Augur-weather paper bot (v0.1)
 *
 * Fast-cycle weather bond harvesting:
 * - Scan markets settling in 12–36 hours
 * - Select near-certain sides priced 0.93–0.99 with tight spread
 * - Sanity check via NWS hourly forecast max
 * - Paper-buy and hold to settlement
 * - Score settlement later via NOAA CDO (GHCND daily TMAX/TMIN)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { KalshiClient } from '../lib/kalshi_client.mjs';
import { loadEnvFile, jsonlWriter } from '../lib/util.mjs';
import { forecastHighInWindowF } from './lib/nws.mjs';
import { getDailyTmaxF, getDailyTminF } from './lib/noaa_cdo.mjs';
import { loadPositions, savePositions, computeDeployed } from './lib/paper_portfolio.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function bestLevel(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const [p, q] = levels[0];
  const price = Number(p);
  const qty = Number(q);
  if (!(Number.isFinite(price) && Number.isFinite(qty))) return null;
  return { price, qty };
}

function computeSpreads(ob) {
  const yesB = bestLevel(ob?.orderbook?.yes);
  const noB = bestLevel(ob?.orderbook?.no);
  const yesAskC = noB ? (100 - noB.price) : null;
  const noAskC  = yesB ? (100 - yesB.price) : null;
  const yesSpreadC = (yesB && yesAskC != null) ? (yesAskC - yesB.price) : null;
  const noSpreadC  = (noB  && noAskC  != null) ? (noAskC  - noB.price) : null;
  return {
    yesBidC: yesB?.price ?? null,
    noBidC: noB?.price ?? null,
    yesAskC,
    noAskC,
    yesAskQty: noB?.qty ?? null,
    noAskQty: yesB?.qty ?? null,
    yesSpreadC,
    noSpreadC,
  };
}

function parseWeatherMarketKind(ticker) {
  if (ticker.startsWith('KXHIGH')) return 'TMAX';
  if (ticker.startsWith('KXLOW')) return 'TMIN';
  return null;
}

function parseStrike(mkt) {
  // Prefer structured strikes.
  const floor = (mkt?.floor_strike != null) ? Number(mkt.floor_strike) : null;
  const cap = (mkt?.cap_strike != null) ? Number(mkt.cap_strike) : null;
  if (Number.isFinite(floor) && Number.isFinite(cap)) return { kind: 'range', lo: floor, hi: cap };
  if (Number.isFinite(floor) && cap == null) return { kind: 'gt', lo: floor };
  if (floor == null && Number.isFinite(cap)) return { kind: 'lt', hi: cap };
  return null;
}

function outcomeForStrike(valueF, strike) {
  if (strike.kind === 'range') return (valueF >= strike.lo && valueF <= strike.hi) ? 1 : 0;
  if (strike.kind === 'gt') return (valueF > strike.lo) ? 1 : 0;
  if (strike.kind === 'lt') return (valueF < strike.hi) ? 1 : 0;
  return 0;
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/augur_v2/weather/config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const envPath = process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env');
  const env = loadEnvFile(envPath);
  const keyId = process.env.KALSHI_API_KEY || env.KALSHI_API_KEY;
  const pkPath = process.env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_PRIVATE_KEY_PATH;
  const baseUrl = (process.env.KALSHI_BASE_URL || env.KALSHI_BASE_URL || cfg.baseUrl).replace(/\/$/, '');
  if (!keyId || !pkPath) throw new Error('Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH');
  const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

  const log = jsonlWriter(cfg.logging.dir, 'augur_weather');
  const client = new KalshiClient({ baseUrl, keyId, privateKeyPem });

  const stationsMeta = JSON.parse(fs.readFileSync(cfg.stations.mapFromWeatherBaseRates, 'utf8'));
  const stationMap = stationsMeta?.stations || {}; // cityCode -> {ghcndStationId,...}

  const token = process.env[cfg.noaaCdo.tokenEnv] || env[cfg.noaaCdo.tokenEnv];
  if (!token) {
    log.write({ t: Date.now(), type: 'warning', msg: 'missing_noaa_cdo_token', env: cfg.noaaCdo.tokenEnv });
  }

  const positionsState = loadPositions(cfg.state.positionsFile);
  if (!Number.isFinite(positionsState.balance)) positionsState.balance = cfg.paper.startingBalance;
  if (!Array.isArray(positionsState.positions)) positionsState.positions = [];

  const killOn = () => { try { return !!(cfg.risk.killSwitchFile && fs.existsSync(cfg.risk.killSwitchFile)); } catch { return false; } };

  async function settleIfPossible() {
    if (!token) return;

    for (const p of positionsState.positions) {
      if (p.status !== 'open') continue;
      const closeMs = Date.parse(p.close_time);
      if (!Number.isFinite(closeMs)) continue;
      // wait at least 12h after close time for CDO data to exist
      if (Date.now() < closeMs + 12 * 3600_000) continue;

      const stationId = p.stationId;
      const dateYmd = String(p.close_time).slice(0, 10);
      let actual = null;
      if (p.metric === 'TMAX') actual = await getDailyTmaxF({ baseUrl: cfg.noaaCdo.baseUrl, token, stationId, dateYmd });
      if (p.metric === 'TMIN') actual = await getDailyTminF({ baseUrl: cfg.noaaCdo.baseUrl, token, stationId, dateYmd });
      if (!Number.isFinite(actual)) continue;

      const win = outcomeForStrike(actual, p.strike);
      const payout = win ? 1.0 : 0.0;
      const cost = p.entryPrice * p.qty;
      const received = payout * p.qty;
      const pnl = received - cost;

      positionsState.balance += received;
      p.status = 'settled';
      p.settledAt = new Date().toISOString();
      p.actual = actual;
      p.win = win;
      p.pnl = pnl;

      log.write({ t: Date.now(), type: 'settlement', ticker: p.ticker, side: p.side, qty: p.qty, entryPrice: p.entryPrice, actual, win, pnl, balance: positionsState.balance });
      await sleep(150);
    }
  }

  async function scanAndBuy() {
    const now = Date.now();
    const minClose = new Date(now + cfg.scanWindow.minHours * 3600_000).toISOString();
    const maxClose = new Date(now + cfg.scanWindow.maxHours * 3600_000).toISOString();

    // Discover weather series
    let cursor = null;
    const series = [];
    for (let page = 0; page < 30; page++) {
      const params = { limit: '500' };
      if (cursor) params.cursor = cursor;
      const resp = await client.getSeries(params);
      const batch = resp?.series || [];
      for (const s of batch) {
        const t = String(s?.ticker || '');
        if (cfg.discovery.weatherSeriesPrefixes.some(p => t.startsWith(p))) series.push(t);
      }
      cursor = resp?.cursor || resp?.next_cursor || resp?.nextCursor || null;
      if (!cursor || batch.length === 0) break;
      await sleep(80);
    }

    const seriesTickers = [...new Set(series)].slice(0, cfg.discovery.maxWeatherSeries);

    const candidates = [];

    // Pull markets per series in window
    for (const st of seriesTickers) {
      let mc = null;
      for (let page = 0; page < 5; page++) {
        const params = { status: 'open', limit: '200', series_ticker: st, min_close_time: minClose, max_close_time: maxClose };
        if (mc) params.cursor = mc;
        const resp = await client.getMarkets(params);
        const mkts = resp?.markets || [];
        mc = resp?.cursor || resp?.next_cursor || resp?.nextCursor || null;

        for (const m of mkts) {
          const ticker = m.ticker;
          const metric = parseWeatherMarketKind(ticker);
          if (!metric) continue;

          const spreads = { yesAsk: to01(m.yes_ask), noAsk: to01(m.no_ask) };
          const bestSide = Math.max(spreads.yesAsk ?? 0, spreads.noAsk ?? 0);
          if (!(bestSide >= cfg.filters.priceFloor && bestSide <= cfg.filters.priceCeiling)) continue;

          // Require spread check via orderbook.
          const ob = await client.getOrderbook(ticker, 1);
          const s = computeSpreads(ob);

          const side = (spreads.noAsk != null && spreads.noAsk >= cfg.filters.priceFloor && spreads.noAsk <= cfg.filters.priceCeiling) ? 'NO'
            : (spreads.yesAsk != null && spreads.yesAsk >= cfg.filters.priceFloor && spreads.yesAsk <= cfg.filters.priceCeiling) ? 'YES'
            : null;
          if (!side) continue;

          const askC = (side === 'YES') ? s.yesAskC : s.noAskC;
          const bidC = (side === 'YES') ? s.yesBidC : s.noBidC;
          const askQty = (side === 'YES') ? s.yesAskQty : s.noAskQty;
          const spreadC = (side === 'YES') ? s.yesSpreadC : s.noSpreadC;

          if (!(Number.isFinite(askC) && Number.isFinite(bidC) && Number.isFinite(askQty) && Number.isFinite(spreadC))) continue;
          if (spreadC > cfg.filters.maxSpreadCents) continue;
          if (askQty < cfg.filters.minAskQty) continue;

          const strike = parseStrike(m);
          if (!strike) continue;

          // NWS sanity check: for TMAX markets, require forecast high margin.
          // We only support city tickers we can map to stations + lat/lon via weather_base_rates + existing cities.json.
          const cityKey = ticker.match(/^KX(?:HIGH|LOW)([A-Z]{2,4})/i)?.[1] || null;
          const stationEntry = Object.values(stationMap).find(x => String(x.ghcndStationId||'').length>0 && (String(x.city||'').toUpperCase().includes(cityKey||''))) || null;
          // Better: rely on weather project cities.json for lat/lon mapping.
          // For v0.1, only accept KXHIGHNY/KXHIGHCHI/KXHIGHMI/KXHIGHAUS/KXHIGHLAX (and LOW variants).
          const cMap = {
            NY: { lat: 40.7829, lon: -73.9654, stationId: 'USW00094728' },
            CHI: { lat: 41.7868, lon: -87.7522, stationId: 'USW00014819' },
            MI: { lat: 25.7959, lon: -80.2870, stationId: 'USW00012839' },
            AUS: { lat: 30.1945, lon: -97.6699, stationId: 'USW00013904' },
            LAX: { lat: 34.0236, lon: -118.2916, stationId: 'USW00093134' },
          };
          const city = Object.keys(cMap).find(k => ticker.includes(k)) || null;
          if (!city) continue;

          const { lat, lon, stationId } = cMap[city];

          const closeTimeIso = m.close_time;
          const windowStartIso = new Date(Date.parse(closeTimeIso) - 24 * 3600_000).toISOString();
          const windowEndIso = closeTimeIso;
          const fh = await forecastHighInWindowF({ lat, lon, ua: cfg.nws.userAgent, windowStartIso, windowEndIso });
          if (!Number.isFinite(fh.maxF)) continue;

          // Margin check relative to strike.
          const minMargin = Number(cfg.nws.minMarginF);
          let ok = true;
          if (metric === 'TMAX') {
            if (strike.kind === 'gt') {
              // Market: high > lo. If buying YES, require forecastHigh >= lo + margin. If buying NO, require forecastHigh <= lo - margin.
              if (side === 'YES') ok = fh.maxF >= (strike.lo + minMargin);
              if (side === 'NO') ok = fh.maxF <= (strike.lo - minMargin);
            } else if (strike.kind === 'lt') {
              // Market: high < hi.
              if (side === 'YES') ok = fh.maxF <= (strike.hi - minMargin);
              if (side === 'NO') ok = fh.maxF >= (strike.hi + minMargin);
            } else {
              // range bracket markets: skip for Augur-weather (v0.1)
              ok = false;
            }
          } else {
            // TMIN not implemented in sanity check yet.
            ok = false;
          }
          if (!ok) continue;

          candidates.push({ ticker, side, askPrice: askC / 100, askQty, spreadC, close_time: m.close_time, stationId, metric, strike, forecastHigh: fh.maxF });
        }

        if (!mc || mkts.length === 0) break;
        await sleep(80);
      }
      await sleep(60);
    }

    // Sort by price descending (most certain first)
    candidates.sort((a, b) => b.askPrice - a.askPrice);

    log.write({ t: Date.now(), type: 'scan', window: { minClose, maxClose }, candidates: candidates.length, sample: candidates.slice(0, 25) });

    // Paper buy up to minPositions while respecting maxPositions.
    const open = positionsState.positions.filter(p => p.status === 'open');
    const need = Math.max(0, cfg.paper.minPositions - open.length);
    const room = Math.max(0, cfg.paper.maxPositions - open.length);
    const toTake = Math.min(need, room);

    let deployed = computeDeployed(open);
    const maxDeployed = cfg.paper.maxDeployedPct * positionsState.balance;

    let taken = 0;
    for (const c of candidates) {
      if (taken >= toTake) break;
      if (open.some(p => p.ticker === c.ticker && p.side === c.side && p.status === 'open')) continue;

      const costPer = c.askPrice;
      const maxPosDollars = cfg.paper.maxPositionPct * positionsState.balance;
      const qty = Math.max(1, Math.floor(maxPosDollars / costPer));

      const cost = qty * costPer;
      if (deployed + cost > maxDeployed) continue;

      // Reserve
      positionsState.balance -= cost;
      deployed += cost;

      positionsState.positions.push({
        id: `paper_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        status: 'open',
        ticker: c.ticker,
        side: c.side,
        qty,
        entryPrice: c.askPrice,
        close_time: c.close_time,
        metric: c.metric,
        stationId: c.stationId,
        strike: c.strike,
        forecastHigh: c.forecastHigh,
        createdAt: new Date().toISOString(),
      });

      log.write({ t: Date.now(), type: 'paper_buy', ticker: c.ticker, side: c.side, qty, price: c.askPrice, spreadC: c.spreadC, close_time: c.close_time, forecastHigh: c.forecastHigh, strike: c.strike, balance: positionsState.balance });
      taken++;
      await sleep(50);
    }

    savePositions(cfg.state.positionsFile, positionsState);
  }

  while (true) {
    if (killOn()) {
      log.write({ t: Date.now(), type: 'killed', reason: 'kill_switch_file_present' });
      savePositions(cfg.state.positionsFile, positionsState);
      process.exit(0);
    }

    try {
      await settleIfPossible();
      await scanAndBuy();
    } catch (e) {
      log.write({ t: Date.now(), type: 'error', message: String(e?.message || e), status: e?.status || null });
    }

    await sleep(cfg.pollIntervalMs);
  }
}

main().catch((e) => {
  console.error('AUGUR_WEATHER_FATAL:', e?.message || e);
  process.exit(1);
});

function to01(x) {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

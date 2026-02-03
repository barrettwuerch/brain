#!/usr/bin/env node
/**
 * weather_bot.mjs (v0.1)
 *
 * Paper-trading market maker for Kalshi daily high-temperature bracket markets.
 *
 * v0.1 FV model: Gaussian placeholder centered on NWS forecast high with horizon-dependent sigma.
 *
 * IMPORTANT: paper only.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function nowMs() { return Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.trunc(n))); }

function parseEnvFile(s) {
  const out = {};
  for (const line of String(s).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function loadEnvFile(p) {
  if (!p || !fs.existsSync(p)) return {};
  return parseEnvFile(fs.readFileSync(p, 'utf8'));
}

function signPssBase64(privateKeyPem, text) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

class KalshiClient {
  constructor({ baseUrl, keyId, privateKeyPem }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.keyId = keyId;
    this.privateKeyPem = privateKeyPem;
  }

  async signedFetch(method, apiPath, { body, query } = {}) {
    const q = query ? ('?' + new URLSearchParams(query).toString()) : '';
    const fullPath = apiPath + q;
    const ts = String(Date.now());
    const msg = ts + method.toUpperCase() + apiPath;
    const sig = signPssBase64(this.privateKeyPem, msg);

    const headers = {
      'KALSHI-ACCESS-KEY': this.keyId,
      'KALSHI-ACCESS-TIMESTAMP': ts,
      'KALSHI-ACCESS-SIGNATURE': sig,
    };

    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(this.baseUrl + fullPath, { method, headers, body: payload });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Kalshi HTTP ${res.status} on ${method} ${apiPath}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  getEvents(params) {
    return this.signedFetch('GET', '/trade-api/v2/events', { query: params });
  }
  getMarkets(params) {
    return this.signedFetch('GET', '/trade-api/v2/markets', { query: params });
  }
  getOrderbook(ticker, depth = 1) {
    return this.signedFetch('GET', `/trade-api/v2/markets/${ticker}/orderbook`, { query: { depth: String(depth) } });
  }
}

function safeMkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function jsonlWriter(dir) {
  safeMkdirp(dir);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${day}.jsonl`);
  return { file, write: (obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n') };
}

function bestBid(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const [p, q] = levels[0];
  return { price: Number(p), qty: Number(q) };
}

function computeTopOfBook(orderbookResp) {
  const yes = orderbookResp?.orderbook?.yes;
  const no = orderbookResp?.orderbook?.no;
  const yb = bestBid(yes);
  const nb = bestBid(no);
  const ya = (nb && Number.isFinite(nb.price)) ? (100 - nb.price) : null;
  const na = (yb && Number.isFinite(yb.price)) ? (100 - yb.price) : null;
  const mid = (yb && ya != null) ? Math.round((yb.price + ya) / 2) : null;
  const spread = (yb && ya != null) ? (ya - yb.price) : null;
  return { yb, nb, ya, na, mid, spread };
}

class PaperBroker {
  constructor({ maxOpenOrders, stateFile = null, log = null }) {
    this.maxOpenOrders = maxOpenOrders;
    this.orders = new Map();
    this.nextId = 1;
    this.positions = new Map(); // market -> { yes, no }
    this.lastFillAtMs = new Map();
    this.stateFile = stateFile;
    this.log = log;
    this._loadState();
  }

  _loadState() {
    try {
      if (!this.stateFile) return;
      if (!fs.existsSync(this.stateFile)) return;
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      const pos = parsed?.positions || {};
      for (const [m, p] of Object.entries(pos)) {
        this.positions.set(m, { yes: Number(p?.yes || 0), no: Number(p?.no || 0) });
      }
      this.log?.write?.({ t: nowMs(), type: 'paper_state_loaded', stateFile: this.stateFile, markets: this.positions.size });
    } catch {
      this.log?.write?.({ t: nowMs(), type: 'warning', msg: 'paper_state_load_failed', stateFile: this.stateFile });
    }
  }

  _saveState() {
    try {
      if (!this.stateFile) return;
      fs.writeFileSync(this.stateFile, JSON.stringify({ updatedAtMs: nowMs(), positions: Object.fromEntries(this.positions) }, null, 2));
    } catch {
      this.log?.write?.({ t: nowMs(), type: 'warning', msg: 'paper_state_save_failed', stateFile: this.stateFile });
    }
  }

  getPosition(market) {
    return { ...(this.positions.get(market) || { yes: 0, no: 0 }) };
  }

  place(order) {
    if (this.orders.size >= this.maxOpenOrders) return { ok: false, reason: 'max_open_orders' };
    const id = `paper_${this.nextId++}`;
    const o = { id, ...order, status: 'open', createdAtMs: nowMs() };
    this.orders.set(id, o);
    return { ok: true, order: o };
  }

  cancel(orderId) {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false, reason: 'not_found' };
    this.orders.delete(orderId);
    return { ok: true, order: o };
  }

  processSnapshot(market, tob, cfg = {}) {
    const probAtBestBid = Number(cfg?.probFillAtBestBid ?? 0.02);
    const maxSpreadForProbFill = Number(cfg?.maxSpreadForProbFill ?? 6);

    const fills = [];
    for (const [id, o] of this.orders.entries()) {
      if (o.market !== market) continue;
      if (o.status !== 'open') continue;

      let shouldFill = false;
      if (o.side === 'YES') {
        if (tob.ya != null && o.price >= tob.ya) shouldFill = true;
        else if (tob.yb && o.price >= tob.yb.price && tob.spread != null && tob.spread <= maxSpreadForProbFill) {
          shouldFill = Math.random() < probAtBestBid;
        }
      } else if (o.side === 'NO') {
        if (tob.na != null && o.price >= tob.na) shouldFill = true;
        else if (tob.nb && o.price >= tob.nb.price && tob.spread != null && tob.spread <= maxSpreadForProbFill) {
          shouldFill = Math.random() < probAtBestBid;
        }
      }

      if (shouldFill) fills.push(this._fill(id, tob));
    }
    return fills.filter(Boolean);
  }

  _fill(orderId, tobAtFill) {
    const o = this.orders.get(orderId);
    if (!o) return null;
    this.orders.delete(orderId);

    const pos = this.positions.get(o.market) || { yes: 0, no: 0 };
    if (o.side === 'YES') pos.yes += o.qty;
    if (o.side === 'NO') pos.no += o.qty;
    this.positions.set(o.market, pos);
    this._saveState();

    const t = nowMs();
    this.lastFillAtMs.set(o.market, t);

    return { orderId, market: o.market, side: o.side, qty: o.qty, price: o.price, filledAtMs: t, tobAtFill };
  }
}

async function nwsGetJson(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept': 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS HTTP ${res.status}`);
  return res.json();
}

async function getNwsGrid(lat, lon, ua) {
  const j = await nwsGetJson(`https://api.weather.gov/points/${lat},${lon}`, ua);
  const p = j?.properties || {};
  return { office: p.gridId, gridX: p.gridX, gridY: p.gridY };
}

async function getForecastHighNext24h(lat, lon, ua) {
  const g = await getNwsGrid(lat, lon, ua);
  const j = await nwsGetJson(`https://api.weather.gov/gridpoints/${g.office}/${g.gridX},${g.gridY}/forecast/hourly`, ua);
  const periods = j?.properties?.periods || [];
  const now = Date.now();
  const cutoff = now + 24 * 3600_000;
  let maxF = null;
  for (const p of periods) {
    const t = Date.parse(p?.startTime);
    if (!Number.isFinite(t)) continue;
    if (t < now || t > cutoff) continue;
    const temp = Number(p?.temperature);
    if (!Number.isFinite(temp)) continue;
    if (maxF == null || temp > maxF) maxF = temp;
  }
  return { maxF, grid: g };
}

function sigmaForHorizonHours(h, table) {
  for (const row of table) {
    if (h <= Number(row.maxH)) return Number(row.sigmaF);
  }
  return Number(table[table.length - 1]?.sigmaF ?? 3);
}

function normalCdf(x) {
  // Abramowitz-Stegun approximation
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function probBetween(lo, hi, mu, sigma) {
  // inclusive-ish bracket: [lo, hi]
  const zHi = (hi + 0.5 - mu) / sigma;
  const zLo = (lo - 0.5 - mu) / sigma;
  return clamp(normalCdf(zHi) - normalCdf(zLo), 0, 1);
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_config.paper.json');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const cities = JSON.parse(fs.readFileSync(cfg.citiesPath, 'utf8'));

  const envPath = process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env');
  const env = { ...loadEnvFile(envPath), ...process.env };
  const keyId = env.KALSHI_API_KEY;
  const pkPath = env.KALSHI_PRIVATE_KEY_PATH;
  if (!keyId || !pkPath) throw new Error('Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH');
  const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

  const log = jsonlWriter(cfg.logging.dir);
  const client = new KalshiClient({ baseUrl: cfg.baseUrl, keyId, privateKeyPem });
  const paperStateFile = path.join(cfg.logging.dir, 'paper_state.json');
  const broker = new PaperBroker({ maxOpenOrders: cfg.risk.maxOpenOrders, stateFile: paperStateFile, log });

  let shuttingDown = false;
  function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.write({ t: nowMs(), type: 'shutdown', signal, openOrders: broker.orders.size, positions: Object.fromEntries(broker.positions) });
    process.exit(0);
  }
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  function killSwitchOn() {
    try { return !!(cfg.risk.killSwitchFile && fs.existsSync(cfg.risk.killSwitchFile)); } catch { return false; }
  }

  let errorStreak = 0;
  let lastSummaryAt = 0;

  while (!shuttingDown) {
    const loopStart = nowMs();

    if (killSwitchOn()) {
      log.write({ t: loopStart, type: 'killed', reason: 'kill_switch_file_present' });
      process.exit(0);
    }

    try {
      for (const [code, c] of Object.entries(cities)) {
        // v0.1: only discover a couple upcoming events per city
        const evResp = await client.getEvents({ series_ticker: c.kalshiSeries, limit: String(cfg.marketSelection.maxEventsPerCity || 2) });
        const events = evResp?.events || evResp?.data || [];

        // NWS forecast high proxy
        const fh = await getForecastHighNext24h(c.lat, c.lon, cfg.nws.userAgent);
        if (!Number.isFinite(fh.maxF)) {
          log.write({ t: nowMs(), type: 'warning', msg: 'nws_no_forecast_high', city: code });
          continue;
        }

        for (const ev of events.slice(0, cfg.marketSelection.maxEventsPerCity || 2)) {
          const et = ev?.event_ticker || ev?.ticker;
          if (!et) continue;

          const mkResp = await client.getMarkets({ event_ticker: et, limit: String(cfg.marketSelection.maxBracketsPerEvent || 30), status: 'open' });
          const markets = mkResp?.markets || [];

          for (const mkt of markets) {
            const ticker = mkt?.ticker;
            if (!ticker) continue;

            // Orderbook + snapshot
            const ob = await client.getOrderbook(ticker, cfg.orderbookDepth ?? 1);
            const tob = computeTopOfBook(ob);
            log.write({ t: nowMs(), type: 'snapshot', market: ticker, tob, city: code, event: et });

            if (!tob.yb && !tob.nb) continue;
            if (tob.mid == null || tob.spread == null) continue;
            if (tob.spread < cfg.strategy.minQuotedSpreadCents) continue;

            // Bracket parsing (best-effort)
            const title = String(mkt?.title || '');
            const rules = String(mkt?.rules_primary || '') + '\n' + String(mkt?.rules_secondary || '');
            const combined = (title + ' ' + rules).toLowerCase();
            let lo = null;
            let hi = null;
            let m = combined.match(/(\d{1,3})\s*(?:–|-|to)\s*(\d{1,3})/);
            if (m) { lo = Number(m[1]); hi = Number(m[2]); }
            if (!(Number.isFinite(lo) && Number.isFinite(hi))) continue;

            // FV from Gaussian placeholder
            const closeMs = Date.parse(mkt?.close_time || mkt?.closeTime || '');
            const horizonH = Number.isFinite(closeMs) ? Math.max(0, (closeMs - nowMs()) / 3600000) : 24;
            const sigma = sigmaForHorizonHours(horizonH, cfg.fv.sigmaByHorizonHours);
            const p = probBetween(lo, hi, fh.maxF, sigma);
            const fv = clampInt(Math.round(p * 100), 1, 99);

            // Quote around FV
            const half = Math.max(1, Number(cfg.strategy.quoteHalfSpreadCents));
            const targetYes = clampInt(fv - half, 1, 99);
            const targetNo = clampInt((100 - fv) - half, 1, 99);

            const pos = broker.getPosition(ticker);
            const atYesLimit = pos.yes >= cfg.strategy.maxPositionQtyPerBracket;
            const atNoLimit = pos.no >= cfg.strategy.maxPositionQtyPerBracket;

            // max-age sweep once per loop could be added later; keep v0.1 minimal.

            const hasYes = [...broker.orders.values()].some(o => o.market === ticker && o.side === 'YES');
            const hasNo = [...broker.orders.values()].some(o => o.market === ticker && o.side === 'NO');

            if (!atYesLimit && !hasYes) {
              const r = broker.place({ market: ticker, side: 'YES', price: targetYes, qty: cfg.strategy.maxOrderQty });
              log.write({ t: nowMs(), type: 'order', mode: 'paper', action: 'place', market: ticker, side: 'YES', price: targetYes, qty: cfg.strategy.maxOrderQty, ok: r.ok, reason: r.reason || null, fv, city: code, event: et });
            }
            if (!atNoLimit && !hasNo) {
              const r = broker.place({ market: ticker, side: 'NO', price: targetNo, qty: cfg.strategy.maxOrderQty });
              log.write({ t: nowMs(), type: 'order', mode: 'paper', action: 'place', market: ticker, side: 'NO', price: targetNo, qty: cfg.strategy.maxOrderQty, ok: r.ok, reason: r.reason || null, fv, city: code, event: et });
            }

            // Fill simulation
            const fills = broker.processSnapshot(ticker, tob, {
              probFillAtBestBid: cfg.strategy.probFillAtBestBid,
              maxSpreadForProbFill: cfg.strategy.maxSpreadForProbFill,
            });
            for (const f of fills) {
              log.write({ t: nowMs(), type: 'fill', ...f, city: code, event: et });
            }
          }
        }
      }

      errorStreak = 0;
    } catch (err) {
      errorStreak++;
      log.write({ t: nowMs(), type: 'error', errorStreak, message: String(err?.message || err), status: err?.status || null, details: err?.data?.error || null });
      if (errorStreak >= cfg.risk.maxErrorStreak) {
        log.write({ t: nowMs(), type: 'halt', reason: 'max_error_streak' });
        process.exit(2);
      }
    }

    if (cfg.logging.consoleSummaryEveryMs && (loopStart - lastSummaryAt) >= cfg.logging.consoleSummaryEveryMs) {
      lastSummaryAt = loopStart;
      console.log(`[kalshi-weather-paper] openOrders=${broker.orders.size} positions=${JSON.stringify(Object.fromEntries(broker.positions))} log=${log.file}`);
    }

    const elapsed = nowMs() - loopStart;
    await sleep(Math.max(0, cfg.pollIntervalMs - elapsed));
  }
}

main().catch((e) => {
  console.error('BOT_FATAL:', e?.message || e);
  process.exit(1);
});

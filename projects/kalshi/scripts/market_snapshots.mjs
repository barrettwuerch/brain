#!/usr/bin/env node
/**
 * market_snapshots.mjs
 *
 * Lightweight periodic market snapshotter:
 * - discovers mention markets (same pipeline as bot selection: mention series -> events -> markets)
 * - records best bid/ask + mid + spread for each market
 * - writes JSONL to projects/kalshi/market_snapshots/YYYY-MM-DD.jsonl
 *
 * Goal: keep a time series of market mids even when the bot is idle,
 * so we can validate FV/news layers vs actual market movement.
 *
 * Usage:
 *   node projects/kalshi/scripts/market_snapshots.mjs --config projects/kalshi/config.paper.json
 * Options:
 *   --limit <n>            max markets to snapshot (default 200)
 *   --sleepMs <ms>         delay between per-market requests (default 150)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function nowMs() { return Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

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
    const msg = ts + method.toUpperCase() + apiPath; // sign without query
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

  getOrderbook(ticker, depth = 1) {
    return this.signedFetch('GET', `/trade-api/v2/markets/${ticker}/orderbook`, { query: { depth: String(depth) } });
  }
  getSeries(params) {
    return this.signedFetch('GET', '/trade-api/v2/series', { query: params });
  }
  getEvents(params) {
    return this.signedFetch('GET', '/trade-api/v2/events', { query: params });
  }
  getMarkets(params) {
    return this.signedFetch('GET', '/trade-api/v2/markets', { query: params });
  }
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

async function getMentionSeriesTickers(client, { maxSeries = 50 } = {}) {
  const resp = await client.getSeries({});
  const series = resp?.series || [];
  const mention = series.filter(s => String(s.category || '').toLowerCase() === 'mentions');
  return mention.slice(0, maxSeries).map(s => String(s.ticker)).filter(Boolean);
}

async function getEventsForSeries(client, seriesTicker, { limit = 100 } = {}) {
  const resp = await client.getEvents({ series_ticker: seriesTicker, limit: String(limit) });
  return resp?.events || resp?.data || [];
}

async function getMarketsForEvent(client, eventTicker, { limit = 200 } = {}) {
  const resp = await client.getMarkets({ event_ticker: eventTicker, limit: String(limit), status: 'open' });
  return resp?.markets || [];
}

function safeMkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function jsonlWriter(dir) {
  safeMkdirp(dir);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${day}.jsonl`);
  return { file, write: (obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n') };
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const envPath = process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env');
  const env = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
  const keyId = process.env.KALSHI_API_KEY || env.KALSHI_API_KEY;
  const pkPath = process.env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_PRIVATE_KEY_PATH;
  if (!keyId || !pkPath) throw new Error('Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH');
  const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

  const client = new KalshiClient({ baseUrl: cfg.baseUrl, keyId, privateKeyPem });

  const outDir = path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/market_snapshots');
  const log = jsonlWriter(outDir);

  const maxSeries = Number(cfg.marketSelection?.maxMentionSeries ?? 30);
  const maxEventsPerSeries = Number(cfg.marketSelection?.maxEventsPerSeries ?? 10);
  const limit = Number(arg('--limit', 200));
  const sleepMs = Number(arg('--sleepMs', 150));

  const seriesTickers = await getMentionSeriesTickers(client, { maxSeries });

  const markets = [];
  for (const st of seriesTickers.slice(0, maxSeries)) {
    const events = await getEventsForSeries(client, st, { limit: maxEventsPerSeries });
    for (const ev of events.slice(0, maxEventsPerSeries)) {
      const et = ev?.event_ticker || ev?.ticker;
      if (!et) continue;
      const ms = await getMarketsForEvent(client, et, { limit: 200 });
      markets.push(...ms);
    }
  }

  // Deduplicate tickers, keep open markets only
  const seen = new Set();
  const tickers = [];
  for (const m of markets) {
    const t = String(m?.ticker || '').trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tickers.push(t);
  }

  const runId = `${new Date().toISOString()}_${Math.random().toString(16).slice(2)}`;
  const start = nowMs();

  let ok = 0;
  let fail = 0;

  for (const t of tickers.slice(0, limit)) {
    try {
      const ob = await client.getOrderbook(t, 1);
      const tob = computeTopOfBook(ob);
      log.write({ t: nowMs(), type: 'market_snapshot', runId, market: t, tob });
      ok++;
    } catch (e) {
      fail++;
      log.write({ t: nowMs(), type: 'market_snapshot_error', runId, market: t, message: String(e?.message || e), status: e?.status ?? null });
    }
    if (sleepMs > 0) await sleep(sleepMs);
  }

  log.write({ t: nowMs(), type: 'market_snapshot_run', runId, markets: Math.min(limit, tickers.length), ok, fail, elapsedMs: nowMs() - start, file: log.file });

  console.log(JSON.stringify({ runId, markets: Math.min(limit, tickers.length), ok, fail, file: log.file }, null, 2));
}

main().catch((e) => {
  console.error('SNAPSHOT_FATAL:', e?.message || e);
  process.exit(1);
});

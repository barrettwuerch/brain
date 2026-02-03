#!/usr/bin/env node
/**
 * explore_weather.mjs
 *
 * Purpose:
 * - Discover Kalshi daily high-temperature bracket markets for configured cities
 * - Validate bracket parsing (lo/hi/tails)
 * - Validate NWS connectivity and forecast-high extraction
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function nowMs() { return Date.now(); }
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
  async signedFetch(method, apiPath, { query } = {}) {
    const q = query ? ('?' + new URLSearchParams(query).toString()) : '';
    const fullPath = apiPath + q;
    const ts = String(Date.now());
    const msg = ts + method.toUpperCase() + apiPath;
    const sig = signPssBase64(this.privateKeyPem, msg);
    const res = await fetch(this.baseUrl + fullPath, {
      method,
      headers: {
        'KALSHI-ACCESS-KEY': this.keyId,
        'KALSHI-ACCESS-TIMESTAMP': ts,
        'KALSHI-ACCESS-SIGNATURE': sig,
      }
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Kalshi HTTP ${res.status} ${apiPath}`);
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
}

function parseBracketFromMarket(mkt) {
  const title = String(mkt?.title || '');
  const rules = String(mkt?.rules_primary || '') + '\n' + String(mkt?.rules_secondary || '');
  const combined = (title + ' ' + rules).toLowerCase();

  // Common patterns: "42–43°F" or "42-43" or "42 to 43".
  let m = combined.match(/(\d{1,3})\s*(?:–|-|to)\s*(\d{1,3})\s*°?f/);
  if (!m) m = combined.match(/(\d{1,3})\s*(?:–|-|to)\s*(\d{1,3})\b/);
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
      return { ok: true, kind: 'range', lo, hi };
    }
  }

  // Tails
  m = combined.match(/(\d{1,3})\s*°?f\s*or\s*below/);
  if (m) return { ok: true, kind: 'le', hi: Number(m[1]) };
  m = combined.match(/(\d{1,3})\s*°?f\s*or\s*above/);
  if (m) return { ok: true, kind: 'ge', lo: Number(m[1]) };

  return { ok: false, reason: 'no_bracket_match', title };
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

async function getForecastHighF(lat, lon, ua) {
  const g = await getNwsGrid(lat, lon, ua);
  const j = await nwsGetJson(`https://api.weather.gov/gridpoints/${g.office}/${g.gridX},${g.gridY}/forecast/hourly`, ua);
  const periods = j?.properties?.periods || [];
  // Take max temperature over next 24h as a v0.1 proxy for "daily high".
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

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const cities = JSON.parse(fs.readFileSync(cfg.citiesPath, 'utf8'));
  const envPath = process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env');
  const env = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
  const keyId = process.env.KALSHI_API_KEY || env.KALSHI_API_KEY;
  const pkPath = process.env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_PRIVATE_KEY_PATH;
  if (!keyId || !pkPath) throw new Error('Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH');
  const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

  const client = new KalshiClient({ baseUrl: cfg.baseUrl, keyId, privateKeyPem });

  console.log('=== Weather Explorer ===');

  for (const [code, c] of Object.entries(cities)) {
    console.log(`\n--- ${code} ${c.city} series=${c.kalshiSeries} station=${c.nwsStation} ---`);

    // NWS check
    try {
      const fh = await getForecastHighF(c.lat, c.lon, cfg.nws.userAgent);
      console.log('NWS forecast high next-24h (F):', fh.maxF, 'grid:', fh.grid);
    } catch (e) {
      console.log('NWS error:', String(e?.message || e));
    }

    // Kalshi discovery: events by series
    let events = [];
    try {
      const r = await client.getEvents({ series_ticker: c.kalshiSeries, limit: String(cfg.marketSelection.maxEventsPerCity || 2) });
      events = r?.events || r?.data || [];
    } catch (e) {
      console.log('Kalshi events error:', String(e?.message || e));
      continue;
    }

    for (const ev of events.slice(0, cfg.marketSelection.maxEventsPerCity || 2)) {
      const et = ev?.event_ticker || ev?.ticker;
      console.log('event:', et, ev?.title || '');
      if (!et) continue;

      let markets = [];
      try {
        const r = await client.getMarkets({ event_ticker: et, limit: String(cfg.marketSelection.maxBracketsPerEvent || 30), status: 'open' });
        markets = r?.markets || [];
      } catch (e) {
        console.log('Kalshi markets error:', String(e?.message || e));
        continue;
      }

      for (const mkt of markets.slice(0, 10)) {
        const parsed = parseBracketFromMarket(mkt);
        console.log('-', mkt.ticker, '|', (mkt.title || '').slice(0, 80), '| bracket:', parsed.ok ? parsed : parsed.reason);
      }
    }
  }
}

main().catch((e) => {
  console.error('EXPLORE_FATAL:', e?.message || e);
  process.exit(1);
});

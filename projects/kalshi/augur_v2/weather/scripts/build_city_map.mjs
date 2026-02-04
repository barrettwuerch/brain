#!/usr/bin/env node
/**
 * build_city_map.mjs
 *
 * Build a mapping from Kalshi weather series tickers (KXHIGH*, KXLOW*) to:
 * - a best-guess NOAA GHCNd station id (USW… or USC…)
 * - lat/lon (from ghcnd-stations)
 *
 * This enables:
 * - NWS points + hourly forecast lookup (needs lat/lon)
 * - NOAA CDO daily TMAX/TMIN settlement check (needs station id)
 *
 * Heuristic matching: token overlap between series title and station name.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { KalshiClient } from '../../lib/kalshi_client.mjs';
import { loadEnvFile } from '../../lib/util.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

function parseGhcndStations(txt) {
  const lines = txt.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const id = line.slice(0, 11).trim();
    const lat = Number(line.slice(12, 20).trim());
    const lon = Number(line.slice(21, 30).trim());
    const name = line.slice(41, 71).trim();
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ id, lat, lon, name });
  }
  return out;
}

function tokens(s) {
  return String(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length >= 3 && !['THE','AND','FOR','IN','ON','TEMPERATURE','HIGHEST','LOWEST','DAILY','MAXIMUM','MINIMUM'].includes(t));
}

function scoreStation(seriesTitle, stationName) {
  const st = new Set(tokens(seriesTitle));
  const tt = tokens(stationName);
  if (st.size === 0 || tt.length === 0) return 0;
  let hit = 0;
  for (const t of tt) if (st.has(t)) hit++;
  // penalize huge names a bit
  return hit / Math.sqrt(tt.length);
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
  const client = new KalshiClient({ baseUrl, keyId, privateKeyPem });

  const cacheDir = path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/.cache');
  const stationsCache = path.join(cacheDir, 'ghcnd-stations.txt');
  if (!fs.existsSync(stationsCache)) {
    await fetchToFile('https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt', stationsCache);
  }
  const stations = parseGhcndStations(fs.readFileSync(stationsCache, 'utf8'))
    .filter(s => s.id.startsWith('USW') || s.id.startsWith('USC'));

  // Pull series list (limited pages)
  const prefixes = (cfg.discovery.weatherSeriesPrefixes || ['KXHIGH','KXLOW']);
  const maxSeries = Number(cfg.discovery.maxWeatherSeries || 200);

  let cursor = null;
  const series = [];
  for (let page = 0; page < 40; page++) {
    const params = { limit: '500' };
    if (cursor) params.cursor = cursor;
    const resp = await client.getSeries(params);
    const batch = resp?.series || [];
    for (const s of batch) {
      const t = String(s?.ticker || '');
      if (prefixes.some(p => t.startsWith(p))) series.push({ ticker: t, title: s.title || '' });
    }
    cursor = resp?.cursor || resp?.next_cursor || resp?.nextCursor || null;
    if (!cursor || batch.length === 0) break;
    await sleep(80);
  }

  // De-dup + cap
  const uniq = new Map();
  for (const s of series) if (!uniq.has(s.ticker)) uniq.set(s.ticker, s);
  const seriesList = [...uniq.values()].slice(0, maxSeries);

  const out = {
    generatedAt: new Date().toISOString(),
    note: 'Heuristic mapping series->GHCNd station using token overlap on series title vs station name.',
    series: {},
    stats: { totalSeries: seriesList.length, mapped: 0, lowConfidence: 0 }
  };

  for (const s of seriesList) {
    let best = null;
    for (const st of stations) {
      const sc = scoreStation(s.title, st.name);
      if (!best || sc > best.score) best = { ...st, score: sc };
    }

    const confidence = best?.score ?? 0;
    const mapped = confidence >= 0.25; // heuristic threshold
    if (mapped) out.stats.mapped++; else out.stats.lowConfidence++;

    out.series[s.ticker] = {
      title: s.title,
      ghcndStationId: mapped ? best.id : null,
      lat: mapped ? best.lat : null,
      lon: mapped ? best.lon : null,
      stationName: mapped ? best.name : null,
      confidence,
    };
  }

  const outPath = arg('--out', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/augur_v2/weather/city_map.json'));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote:', outPath);
  console.log('Series:', out.stats);
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * archive_forecasts.mjs
 *
 * Lightweight forecast archiver (no Kalshi).
 * Hits NWS points + hourly forecast for each city and appends one record per city.
 *
 * Output: projects/kalshi/weather/forecast_archive.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

async function nwsGetJson(url, ua) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept': 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS HTTP ${res.status} ${url}`);
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
  return { maxF, grid: g, fetchedAt: new Date().toISOString() };
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const cities = JSON.parse(fs.readFileSync(cfg.citiesPath, 'utf8'));

  const outPath = arg('--out', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/forecast_archive.jsonl'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const ua = cfg?.nws?.userAgent || 'OpenClaw-WeatherForecastArchiver/0.1';

  for (const [code, c] of Object.entries(cities)) {
    try {
      const fh = await getForecastHighNext24h(c.lat, c.lon, ua);
      const rec = {
        t: Date.now(),
        iso: new Date().toISOString(),
        type: 'forecast_archive',
        city: code,
        lat: c.lat,
        lon: c.lon,
        grid: fh.grid,
        forecastHighNext24hF: fh.maxF,
      };
      fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
      console.log(`${code}: forecastHighNext24hF=${fh.maxF}`);
    } catch (e) {
      const rec = {
        t: Date.now(),
        iso: new Date().toISOString(),
        type: 'forecast_archive_error',
        city: code,
        error: String(e?.message || e),
      };
      fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
      console.log(`${code}: ERROR ${rec.error}`);
    }
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});

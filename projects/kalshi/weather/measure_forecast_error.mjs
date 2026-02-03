#!/usr/bin/env node
/**
 * measure_forecast_error.mjs
 *
 * Builds an archive of forecast->actual errors when both are available.
 *
 * Inputs:
 * - forecast archive jsonl (from archive_forecasts.mjs)
 * - daily series (weather_daily_series.json)
 *
 * Today: only a handful of pairs exist, but this script also supports "seeding" a
 * 7-day lookahead forecast capture (writes a second jsonl with target dates).
 *
 * Note: NWS doesn't provide historical forecasts via API; we accumulate going forward.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function parseJsonl(p) {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
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

function ymdOfIso(iso) {
  return String(iso).slice(0, 10);
}

async function seed7DayForecasts({ cities, ua, outPath }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  for (const [code, c] of Object.entries(cities)) {
    const g = await getNwsGrid(c.lat, c.lon, ua);
    const j = await nwsGetJson(`https://api.weather.gov/gridpoints/${g.office}/${g.gridX},${g.gridY}/forecast/hourly`, ua);
    const periods = j?.properties?.periods || [];

    // Group hourly temps by local-date string from startTime.
    const byDate = new Map();
    for (const p of periods) {
      const iso = p?.startTime;
      const d = ymdOfIso(iso);
      const temp = Number(p?.temperature);
      if (!Number.isFinite(temp)) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(temp);
    }

    for (const [d, temps] of byDate.entries()) {
      const hi = temps.reduce((m, x) => (m == null || x > m) ? x : m, null);
      const rec = {
        t: Date.now(),
        iso: new Date().toISOString(),
        type: 'forecast_seed',
        city: code,
        targetDate: d,
        grid: g,
        forecastHighF: hi,
        source: 'NWS_hourly_grouped_by_date'
      };
      fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
    }
    console.log(`${code}: seeded ${byDate.size} dates`);
  }
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const cities = JSON.parse(fs.readFileSync(cfg.citiesPath, 'utf8'));

  const archivePath = arg('--forecast-archive', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/forecast_archive.jsonl'));
  const dailySeriesPath = arg('--daily', cfg?.fv?.dailySeriesPath);
  const outPath = arg('--out', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/forecast_error.jsonl'));
  const seedPath = arg('--seed-out', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/forecast_seed.jsonl'));

  const ua = cfg?.nws?.userAgent || 'OpenClaw-WeatherForecastError/0.1';

  if (process.argv.includes('--seed-7day')) {
    await seed7DayForecasts({ cities, ua, outPath: seedPath });
    return;
  }

  const daily = JSON.parse(fs.readFileSync(dailySeriesPath, 'utf8'));
  const archive = parseJsonl(archivePath).filter(e => e.type === 'forecast_archive');
  const seed = parseJsonl(seedPath).filter(e => e.type === 'forecast_seed');

  // Index actuals by city+date
  const actualByCityDate = new Map();
  for (const [code, series] of Object.entries(daily)) {
    for (const r of series) {
      actualByCityDate.set(`${code}|${r.date}`, Number(r.tmaxF));
    }
  }

  // Build candidate forecasts indexed by city+targetDate.
  // For archive records, targetDate is "today" of the run (approx). For seed, targetDate explicit.
  const forecasts = [];
  for (const a of archive) {
    const d = ymdOfIso(a.iso);
    forecasts.push({ city: a.city, targetDate: d, forecastHighF: Number(a.forecastHighNext24hF), source: 'archive_next24h', t: a.t, iso: a.iso });
  }
  for (const s of seed) {
    forecasts.push({ city: s.city, targetDate: s.targetDate, forecastHighF: Number(s.forecastHighF), source: 'seed_7day', t: s.t, iso: s.iso });
  }

  let n = 0;
  for (const f of forecasts) {
    const key = `${f.city}|${f.targetDate}`;
    const actual = actualByCityDate.get(key);
    if (!Number.isFinite(actual) || !Number.isFinite(f.forecastHighF)) continue;
    const err = actual - f.forecastHighF;
    const rec = {
      t: Date.now(),
      type: 'forecast_error',
      city: f.city,
      targetDate: f.targetDate,
      forecastHighF: f.forecastHighF,
      actualHighF: actual,
      errorF: err,
      source: f.source,
      forecastIssuedIso: f.iso,
    };
    fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
    n++;
  }

  console.log('appended pairs:', n, 'to', outPath);
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});

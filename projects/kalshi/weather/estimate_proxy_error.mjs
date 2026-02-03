#!/usr/bin/env node
/**
 * estimate_proxy_error.mjs
 *
 * Estimate the "forecast error" distribution induced by using yesterday's observed high
 * as a proxy for today's forecast high.
 *
 * For each city + month:
 *   error = actual_today - proxy_forecast (= yesterday_actual)
 *
 * Outputs:
 * - weather_proxy_error.json  (per city/month error stats)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs) {
  if (xs.length < 2) return null;
  const mu = mean(xs);
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const x = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  if (lo === hi) return sorted[lo];
  const w = x - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function mad(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const med = percentile(s, 0.5);
  const absDev = xs.map(x => Math.abs(x - med)).sort((a, b) => a - b);
  return percentile(absDev, 0.5);
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const dailySeriesPath = cfg?.fv?.dailySeriesPath || arg('--daily', null);
  if (!dailySeriesPath) throw new Error('Missing fv.dailySeriesPath or --daily');

  const dailySeries = JSON.parse(fs.readFileSync(dailySeriesPath, 'utf8'));
  const outPath = arg('--out', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_proxy_error.json'));
  const cityFilter = arg('--city', null);

  const result = {
    generatedAt: new Date().toISOString(),
    note: 'Errors for proxy forecast=previous-day observed high. error = actual_today - yesterday_actual.',
    cities: {}
  };

  const cities = Object.keys(dailySeries).filter(c => !cityFilter || c === cityFilter);

  for (const city of cities) {
    const series = dailySeries[city];
    if (!Array.isArray(series) || series.length < 10) continue;

    const byMonth = new Map(); // mm -> [errors]

    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const cur = series[i];
      const m = String(cur.date).slice(5, 7);
      const a = Number(cur.tmaxF);
      const f = Number(prev.tmaxF);
      if (!(Number.isFinite(a) && Number.isFinite(f))) continue;
      const err = a - f;
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(err);
    }

    result.cities[city] = {};
    for (const [mm, errs] of byMonth.entries()) {
      const s = errs.slice().sort((a, b) => a - b);
      const mu = mean(errs);
      const sd = stddev(errs);
      const m0 = percentile(s, 0.5);
      result.cities[city][mm] = {
        n: errs.length,
        meanErrF: mu == null ? null : Number(mu.toFixed(3)),
        stdErrF: sd == null ? null : Number(sd.toFixed(3)),
        medianErrF: m0 == null ? null : Number(m0.toFixed(3)),
        madErrF: mad(errs) == null ? null : Number(mad(errs).toFixed(3)),
        p10ErrF: percentile(s, 0.10) == null ? null : Number(percentile(s, 0.10).toFixed(3)),
        p90ErrF: percentile(s, 0.90) == null ? null : Number(percentile(s, 0.90).toFixed(3)),
      };
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('Wrote:', outPath);

  // Print quick table for current month
  const curMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  console.log(`\nProxy error σ (std of day-to-day change) for month=${curMonth}`);
  for (const city of Object.keys(result.cities)) {
    const row = result.cities[city][curMonth];
    if (!row) continue;
    console.log(`${city}: n=${row.n} meanErrF=${row.meanErrF} stdErrF=${row.stdErrF} p10=${row.p10ErrF} p90=${row.p90ErrF}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});

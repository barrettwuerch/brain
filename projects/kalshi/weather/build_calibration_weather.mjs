#!/usr/bin/env node
/**
 * build_calibration_weather.mjs
 *
 * Fits isotonic regression calibration for the weather model using the temporal backtest dataset.
 * Uses yesterday's observed high as forecast proxy (until real forecast archive is available).
 *
 * Output: weather_calibration_isotonic.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { computeEmpiricalFVs } from './empirical_fv.mjs';
import { fitIsotonic } from './isotonic.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function buildSyntheticBrackets({ cityCode, month, stats }) {
  const mm = String(month).padStart(2, '0');
  const s = stats?.months?.[cityCode]?.[mm];
  if (!s) return null;
  const L = Math.round(Number(s.p10F));
  const U = Math.round(Number(s.p90F));
  if (!Number.isFinite(L) || !Number.isFinite(U) || L >= U) return null;

  const brackets = [];
  brackets.push({ ticker: `${cityCode}-${mm}-LT${L}`, kind: 'lt', hi: L });
  for (let t = L; t <= U - 1; t += 2) {
    brackets.push({ ticker: `${cityCode}-${mm}-B${t}`, kind: 'range', lo: t, hi: t + 1 });
  }
  brackets.push({ ticker: `${cityCode}-${mm}-GT${U}`, kind: 'gt', lo: U });
  return brackets;
}

function outcome(actual, b) {
  if (b.kind === 'range') return actual >= b.lo && actual <= b.hi ? 1 : 0;
  if (b.kind === 'gt') return actual > b.lo ? 1 : 0;
  if (b.kind === 'lt') return actual < b.hi ? 1 : 0;
  return 0;
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const stats = JSON.parse(fs.readFileSync(cfg.fv.baseRatesPath, 'utf8'));
  const sortedValues = JSON.parse(fs.readFileSync(cfg.fv.sortedValuesPath, 'utf8'));
  const dailySeries = JSON.parse(fs.readFileSync(cfg.fv.dailySeriesPath, 'utf8'));
  const baseRates = { stats, sortedValues };

  const cityFilter = arg('--city', null);
  const outPath = arg('--out', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_calibration_isotonic.json'));
  const trainEnd = arg('--train-end', null); // YYYY-MM-DD inclusive

  const horizonH = Number(arg('--horizonHours', '24'));

  const xs = [];
  const ys = [];

  const cities = Object.keys(dailySeries).filter(c => !cityFilter || c === cityFilter);

  for (const cityCode of cities) {
    const series = dailySeries[cityCode];
    if (!Array.isArray(series) || series.length < 10) continue;

    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const cur = series[i];
      if (trainEnd && String(cur.date) > trainEnd) continue;

      const actual = Number(cur.tmaxF);
      const forecastProxy = Number(prev.tmaxF);
      if (!(Number.isFinite(actual) && Number.isFinite(forecastProxy))) continue;

      const month = Number(cur.date.slice(5, 7));
      const brackets = buildSyntheticBrackets({ cityCode, month, stats });
      if (!brackets) continue;

      const emp = computeEmpiricalFVs({
        brackets,
        cityCode,
        month,
        forecastHighF: forecastProxy,
        horizonHours: horizonH,
        baseRates,
        horizonWeights: cfg?.forecast?.horizonWeights,
        thinTail: cfg?.fv?.thinTail,
      });

      for (const b of brackets) {
        const p = emp.fvByTicker.get(b.ticker)?.prob;
        if (!Number.isFinite(p)) continue;
        xs.push(clamp(p, 0, 1));
        ys.push(outcome(actual, b));
      }
    }
  }

  const blocks = fitIsotonic({ x: xs, y: ys });

  const payload = {
    kind: 'isotonic',
    generatedAt: new Date().toISOString(),
    trainEnd: trainEnd || null,
    note: 'Fit using temporal backtest with yesterday-observed forecast proxy. Replace with real forecast archive once available.',
    n: xs.length,
    blocks,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log('Wrote:', outPath);
  console.log('n points:', xs.length, 'blocks:', blocks.length);
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});

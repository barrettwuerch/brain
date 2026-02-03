#!/usr/bin/env node
/**
 * backtest_weather.mjs
 *
 * Offline backtest using historical observed highs (GHCNd) already downloaded.
 *
 * Caveat (intentional): we only have monthly sorted values, so temporal ordering
 * is lost. The "forecast proxy" used here is adjacent value in the sorted array.
 * This is much less informative than a real NWS forecast, so any edge here is
 * a conservative / handicapped test.
 *
 * Usage:
 *   node projects/kalshi/weather/backtest_weather.mjs --config projects/kalshi/weather/weather_config.paper.json
 *   node projects/kalshi/weather/backtest_weather.mjs --config ... --city CHI --detail
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { computeEmpiricalFVs } from './empirical_fv.mjs';
import { loadCalibrationObject } from './calibration.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function hasFlag(name) { return process.argv.includes(name); }

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function mean(xs) {
  if (!xs?.length) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs) {
  if (!xs?.length || xs.length < 2) return null;
  const mu = mean(xs);
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
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

function bracketProbabilityNormal(mu, sigma, bracket) {
  // Same boundary semantics as empirical model.
  let loB = -Infinity;
  let hiB = Infinity;

  if (bracket.kind === 'range') {
    loB = bracket.lo - 0.5;
    hiB = bracket.hi + 0.5;
  } else if (bracket.kind === 'gt') {
    loB = bracket.lo + 0.5;
  } else if (bracket.kind === 'lt') {
    hiB = bracket.hi - 0.5;
  }

  const cdf = (x) => {
    if (x === Infinity) return 1;
    if (x === -Infinity) return 0;
    return normalCdf((x - mu) / sigma);
  };

  return clamp(cdf(hiB) - cdf(loB), 0, 1);
}

function allocateCoherentCents(probByTicker) {
  const raw = [...probByTicker.entries()].map(([ticker, prob]) => ({ ticker, prob: clamp(Number(prob) || 0, 0, 1) }));
  const total = raw.reduce((s, r) => s + r.prob, 0);

  if (!(total > 0) || raw.length === 0) {
    const uniform = raw.length ? 1 / raw.length : 0;
    const out = new Map();
    for (const r of raw) out.set(r.ticker, { prob: uniform, fvCents: Math.max(1, Math.min(99, Math.round(uniform * 100))) });
    return out;
  }

  const norm = raw.map(r => ({ ticker: r.ticker, prob: r.prob / total }));

  const cents = norm.map(r => {
    const exact = r.prob * 100;
    let base = Math.floor(exact);
    const frac = exact - base;
    base = Math.max(1, Math.min(99, base));
    return { ticker: r.ticker, prob: r.prob, base, frac };
  });

  let sum = cents.reduce((s, c) => s + c.base, 0);
  if (sum < 100) {
    cents.sort((a, b) => b.frac - a.frac);
    let i = 0;
    while (sum < 100 && cents.length) {
      const c = cents[i % cents.length];
      if (c.base < 99) { c.base += 1; sum += 1; }
      i++;
      if (i > 10000) break;
    }
  } else if (sum > 100) {
    cents.sort((a, b) => a.frac - b.frac);
    let i = 0;
    while (sum > 100 && cents.length) {
      const c = cents[i % cents.length];
      if (c.base > 1) { c.base -= 1; sum -= 1; }
      i++;
      if (i > 10000) break;
    }
  }

  const out = new Map();
  for (const c of cents) out.set(c.ticker, { prob: c.prob, fvCents: Math.max(1, Math.min(99, c.base)) });
  return out;
}

function sigmaForHorizonHours(h, table) {
  for (const row of table || []) {
    if (h <= Number(row.maxH)) return Number(row.sigmaF);
  }
  return Number(table?.[table.length - 1]?.sigmaF ?? 3);
}

function buildSyntheticBrackets({ cityCode, month, stats }) {
  const mm = String(month).padStart(2, '0');
  const s = stats?.months?.[cityCode]?.[mm];
  if (!s) return null;

  // Use p10/p90 to set tails; bins of width 2F between.
  const L = Math.round(Number(s.p10F));
  const U = Math.round(Number(s.p90F));
  if (!Number.isFinite(L) || !Number.isFinite(U) || L >= U) return null;

  const brackets = [];
  brackets.push({ ticker: `${cityCode}-${mm}-LT${L}`, kind: 'lt', hi: L });

  // Make 2F-wide bins: [t, t+1] inclusive.
  for (let t = L; t <= U - 1; t += 2) {
    brackets.push({ ticker: `${cityCode}-${mm}-B${t}`, kind: 'range', lo: t, hi: t + 1 });
  }

  brackets.push({ ticker: `${cityCode}-${mm}-GT${U}`, kind: 'gt', lo: U });

  return brackets;
}

function brierForSet({ probsByTicker, brackets, actual }) {
  // outcome y=1 if actual in bracket else 0
  let sum = 0;
  let n = 0;
  for (const b of brackets) {
    const p = probsByTicker.get(b.ticker)?.prob;
    if (!Number.isFinite(p)) continue;
    const y = (b.kind === 'range') ? (actual >= b.lo && actual <= b.hi)
      : (b.kind === 'gt') ? (actual > b.lo)
      : (b.kind === 'lt') ? (actual < b.hi)
      : 0;
    sum += (p - y) ** 2;
    n++;
  }
  return n ? sum / n : null;
}

function updateCalibration(cal, brackets, probsByTicker, actual) {
  for (const b of brackets) {
    const p = probsByTicker.get(b.ticker)?.prob;
    if (!Number.isFinite(p)) continue;
    const y = (b.kind === 'range') ? (actual >= b.lo && actual <= b.hi)
      : (b.kind === 'gt') ? (actual > b.lo)
      : (b.kind === 'lt') ? (actual < b.hi)
      : 0;
    const bi = Math.max(0, Math.min(9, Math.floor(p * 10)));
    const bin = cal[bi];
    bin.n++;
    bin.sumP += p;
    bin.sumY += y;
  }
}

function initCal() {
  return Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, sumP: 0, sumY: 0 }));
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/weather_config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const cityFilter = arg('--city', null);
  const detail = hasFlag('--detail');
  const startYmd = arg('--start', null); // YYYY-MM-DD inclusive
  const endYmd = arg('--end', null);     // YYYY-MM-DD inclusive
  const calPath = arg('--calibration', null);

  const stats = JSON.parse(fs.readFileSync(cfg.fv.baseRatesPath, 'utf8'));
  const sortedValues = JSON.parse(fs.readFileSync(cfg.fv.sortedValuesPath, 'utf8'));
  const dailySeries = cfg?.fv?.dailySeriesPath ? JSON.parse(fs.readFileSync(cfg.fv.dailySeriesPath, 'utf8')) : null;

  const baseRates = { stats, sortedValues };

  const calibrationObj = calPath ? JSON.parse(fs.readFileSync(calPath, 'utf8')) : null;
  const calibrator = calibrationObj ? loadCalibrationObject(calibrationObj) : null;

  const horizonH = 24; // proxy for next-day.
  const sigma = sigmaForHorizonHours(horizonH, cfg.fv.sigmaByHorizonHours);

  const cities = Object.keys(sortedValues).filter(c => !cityFilter || c === cityFilter);

  const calEmp = initCal();
  const calNaive = initCal();
  const calGauss = initCal();

  let nDays = 0;
  let sumEmp = 0;
  let sumNaive = 0;
  let sumGauss = 0;

  for (const cityCode of cities) {
    const series = dailySeries?.[cityCode] || null;
    if (!series || series.length < 10) {
      console.log(`WARN: missing/short daily series for ${cityCode}; falling back to sorted-proxy backtest`);
    }

    // Preferred: temporal backtest using consecutive calendar days.
    if (series && series.length >= 10) {
      for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1];
        const cur = series[i];
        if (startYmd && String(cur.date) < startYmd) continue;
        if (endYmd && String(cur.date) > endYmd) continue;

        const actual = Number(cur.tmaxF);
        const forecastProxy = Number(prev.tmaxF); // yesterday's observed high as proxy for forecast
        const month = Number(cur.date.slice(5, 7));
        const mm = String(month).padStart(2, '0');

        const brackets = buildSyntheticBrackets({ cityCode, month, stats });
        if (!brackets || brackets.length < 3) continue;

        const climMean = stats?.months?.[cityCode]?.[mm]?.meanF;
        const climStd = stats?.months?.[cityCode]?.[mm]?.stdDevF;

        const emp = computeEmpiricalFVs({
          brackets,
          cityCode,
          month,
          forecastHighF: forecastProxy,
          horizonHours: horizonH,
          baseRates,
          horizonWeights: cfg?.forecast?.horizonWeights,
          thinTail: cfg?.fv?.thinTail,
          calibrateProb: calibrator?.predict,
        });

        const naive = computeEmpiricalFVs({
          brackets,
          cityCode,
          month,
          forecastHighF: null,
          horizonHours: horizonH,
          baseRates,
          horizonWeights: cfg?.forecast?.horizonWeights,
          thinTail: { minSamples: 0 },
        });

        const gaussProb = new Map();
        for (const b of brackets) gaussProb.set(b.ticker, bracketProbabilityNormal(forecastProxy, sigma, b));
        const gauss = allocateCoherentCents(gaussProb);

        const bEmp = brierForSet({ probsByTicker: emp.fvByTicker, brackets, actual });
        const bNaive = brierForSet({ probsByTicker: naive.fvByTicker, brackets, actual });
        const bGauss = brierForSet({ probsByTicker: gauss, brackets, actual });
        if (bEmp == null || bNaive == null || bGauss == null) continue;

        nDays++;
        sumEmp += bEmp;
        sumNaive += bNaive;
        sumGauss += bGauss;

        updateCalibration(calEmp, brackets, emp.fvByTicker, actual);
        updateCalibration(calNaive, brackets, naive.fvByTicker, actual);
        updateCalibration(calGauss, brackets, gauss, actual);

        if (detail && i % 200 === 0) {
          const shiftF = (Number.isFinite(climMean) ? (forecastProxy - climMean) : null);
          const shiftSigma = (shiftF != null && Number.isFinite(climStd) && climStd > 0) ? (shiftF / climStd) : null;
          console.log(`${cityCode} date=${cur.date} actual=${actual.toFixed(1)} forecastProxy(yday)=${forecastProxy.toFixed(1)} shiftSigma=${shiftSigma?.toFixed(2)} brier(emp/naive/gauss)=${bEmp.toFixed(4)}/${bNaive.toFixed(4)}/${bGauss.toFixed(4)}`);
        }
      }
      continue;
    }

    // Fallback: original sorted-proxy mode (kept for debugging)
    for (let month = 1; month <= 12; month++) {
      const mm = String(month).padStart(2, '0');
      const values = sortedValues?.[cityCode]?.[mm] || [];
      if (values.length < 30) continue;

      const brackets = buildSyntheticBrackets({ cityCode, month, stats });
      if (!brackets || brackets.length < 3) continue;

      const climMean = stats?.months?.[cityCode]?.[mm]?.meanF;
      const climStd = stats?.months?.[cityCode]?.[mm]?.stdDevF;

      for (let i = 1; i < values.length; i++) {
        const actual = values[i];
        const forecastProxy = values[i - 1];

        const emp = computeEmpiricalFVs({
          brackets,
          cityCode,
          month,
          forecastHighF: forecastProxy,
          horizonHours: horizonH,
          baseRates,
          horizonWeights: cfg?.forecast?.horizonWeights,
          thinTail: cfg?.fv?.thinTail,
          calibrateProb: calibrator?.predict,
        });

        const naive = computeEmpiricalFVs({
          brackets,
          cityCode,
          month,
          forecastHighF: null,
          horizonHours: horizonH,
          baseRates,
          horizonWeights: cfg?.forecast?.horizonWeights,
          thinTail: { minSamples: 0 },
        });

        const gaussProb = new Map();
        for (const b of brackets) gaussProb.set(b.ticker, bracketProbabilityNormal(forecastProxy, sigma, b));
        const gauss = allocateCoherentCents(gaussProb);

        const bEmp = brierForSet({ probsByTicker: emp.fvByTicker, brackets, actual });
        const bNaive = brierForSet({ probsByTicker: naive.fvByTicker, brackets, actual });
        const bGauss = brierForSet({ probsByTicker: gauss, brackets, actual });

        if (bEmp == null || bNaive == null || bGauss == null) continue;

        nDays++;
        sumEmp += bEmp;
        sumNaive += bNaive;
        sumGauss += bGauss;

        updateCalibration(calEmp, brackets, emp.fvByTicker, actual);
        updateCalibration(calNaive, brackets, naive.fvByTicker, actual);
        updateCalibration(calGauss, brackets, gauss, actual);

        if (detail && i % 50 === 0) {
          const shiftF = (Number.isFinite(climMean) ? (forecastProxy - climMean) : null);
          const shiftSigma = (shiftF != null && Number.isFinite(climStd) && climStd > 0) ? (shiftF / climStd) : null;
          console.log(`${cityCode} m=${mm} i=${i}/${values.length} actual=${actual.toFixed(1)} forecastProxy=${forecastProxy.toFixed(1)} shiftSigma=${shiftSigma?.toFixed(2)} brier(emp/naive/gauss)=${bEmp.toFixed(4)}/${bNaive.toFixed(4)}/${bGauss.toFixed(4)}`);
        }
      }
    }
  }

  const avgEmp = sumEmp / Math.max(1, nDays);
  const avgNaive = sumNaive / Math.max(1, nDays);
  const avgGauss = sumGauss / Math.max(1, nDays);

  console.log('\n=== Weather backtest (yesterday-observed forecast proxy; temporal) ===');
  console.log('days:', nDays);
  console.log('avg Brier (lower is better):');
  console.log('- empirical_shifted_cdf:', avgEmp.toFixed(6));
  console.log('- naive_climatology    :', avgNaive.toFixed(6));
  console.log('- gaussian_placeholder :', avgGauss.toFixed(6), `(sigma@${horizonH}h=${sigma})`);

  function printCal(name, cal) {
    console.log(`\nCalibration: ${name}`);
    for (const b of cal) {
      if (!b.n) continue;
      const avgP = b.sumP / b.n;
      const avgY = b.sumY / b.n;
      console.log(`[${b.lo.toFixed(1)},${b.hi.toFixed(1)}): n=${b.n} avgP=${avgP.toFixed(3)} avgY=${avgY.toFixed(3)}`);
    }
  }

  printCal('empirical_shifted_cdf', calEmp);
  printCal('naive_climatology', calNaive);
  printCal('gaussian_placeholder', calGauss);
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});

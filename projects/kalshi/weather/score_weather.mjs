#!/usr/bin/env node
/**
 * score_weather.mjs
 *
 * Scores a settled event against the bot's predicted probabilities.
 *
 * Usage:
 * node projects/kalshi/weather/score_weather.mjs \
 *   --event KXHIGHNY-26FEB03 \
 *   --actual 35 \
 *   --log projects/kalshi/weather/logs/2026-02-03.jsonl \
 *   --append projects/kalshi/weather/calibration_weather.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function parseJsonl(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function inBracket(actual, b) {
  if (b.kind === 'range') return actual >= b.lo && actual <= b.hi;
  if (b.kind === 'gt') return actual > b.lo;
  if (b.kind === 'lt') return actual < b.hi;
  return false;
}

function main() {
  const event = arg('--event');
  const actual = Number(arg('--actual'));
  const logPath = arg('--log');
  const appendPath = arg('--append', null);
  const calibrationMode = process.argv.includes('--calibration');

  if (!logPath) throw new Error('Missing --log');
  const entries = parseJsonl(logPath);

  if (calibrationMode) {
    // Read calibration jsonl and print simple bin stats.
    const calPath = appendPath || logPath;
    const cal = parseJsonl(calPath).filter(e => e.type === 'weather_score');
    const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i/10, hi: (i+1)/10, n: 0, avgP: 0, avgY: 0 }));
    for (const e of cal) {
      for (const r of e.rows || []) {
        const p = r.prob;
        const y = r.outcome;
        const bi = Math.min(9, Math.max(0, Math.floor(p * 10)));
        const b = bins[bi];
        b.n++;
        b.avgP += p;
        b.avgY += y;
      }
    }
    console.log('Calibration bins (deciles):');
    for (const b of bins) {
      if (!b.n) continue;
      console.log(`[${b.lo.toFixed(1)},${b.hi.toFixed(1)}): n=${b.n} avgP=${(b.avgP/b.n).toFixed(3)} avgY=${(b.avgY/b.n).toFixed(3)}`);
    }
    return;
  }

  if (!event) throw new Error('Missing --event');
  if (!Number.isFinite(actual)) throw new Error('Missing/invalid --actual');

  // Find the last fv_detail entry for this event
  const fv = [...entries].reverse().find(e => e.type === 'fv_detail' && e.event === event);
  if (!fv) throw new Error(`No fv_detail found for event=${event} in log`);

  const rows = [];
  let brierSum = 0;
  for (const b of fv.brackets || []) {
    const y = inBracket(actual, b) ? 1 : 0;
    const p = Number(b.prob);
    const bs = (p - y) ** 2;
    brierSum += bs;
    rows.push({ ticker: b.ticker, kind: b.kind, lo: b.lo ?? null, hi: b.hi ?? null, prob: p, fvCents: b.fvCents, outcome: y, brier: bs });
  }

  const avgBrier = rows.length ? (brierSum / rows.length) : null;
  const out = {
    t: Date.now(),
    type: 'weather_score',
    event,
    city: fv.city,
    actualHighF: actual,
    forecastHighF: fv.forecastHighF,
    sigmaF: fv.sigmaF,
    n: rows.length,
    avgBrier,
    rows
  };

  console.log(`event=${event} actual=${actual} n=${rows.length} avgBrier=${avgBrier}`);

  if (appendPath) {
    fs.mkdirSync(path.dirname(appendPath), { recursive: true });
    fs.appendFileSync(appendPath, JSON.stringify(out) + '\n');
    console.log('appended:', appendPath);
  }
}

main();

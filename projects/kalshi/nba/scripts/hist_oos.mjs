#!/usr/bin/env node
/**
 * hist_oos.mjs
 *
 * Out-of-sample split runner (Layer 7).
 *
 * Splits the dataset by date into train/test halves, then reports the same headline metrics
 * on each split (qual rate, recovery rate, implied pnl distribution) under the current rules.
 *
 * Usage:
 *   npm run hist:oos -- --dir ./data_full
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../src/util.mjs';

function loadLatestDatasetFile(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('dataset_') && f.endsWith('.jsonl'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`No dataset_*.jsonl found in ${dir}`);
  return path.join(dir, files[0].f);
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return (s.length % 2) ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(a) {
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function summarize(rows) {
  const games = rows.filter(r => r.type === 'no_event' || r.type === 'qualifying_event');
  const eligible = games.filter(r => Number.isFinite(r.pregame_prob) && r.pregame_prob >= 0.65);
  const qual = rows.filter(r => r.type === 'qualifying_event');

  const pnl = qual.map(r => r.implied_pnl_cents).filter(Number.isFinite);
  const pos = pnl.filter(x => x > 0).length;

  const rec = qual.filter(r => r.recovered_60 === true).length;

  return {
    games: games.length,
    eligible: eligible.length,
    qualifying: qual.length,
    qual_rate_conditional: eligible.length ? (qual.length / eligible.length) : null,
    recovery_rate: qual.length ? (rec / qual.length) : null,
    implied_pnl_avg_c: avg(pnl),
    implied_pnl_median_c: median(pnl),
    implied_pnl_pct_pos: pnl.length ? (pos / pnl.length) : null,
    n_pnl: pnl.length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const file = args.file || loadLatestDatasetFile(dir);

  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));

  // Split by date median
  const games = rows.filter(r => r.type === 'no_event' || r.type === 'qualifying_event');
  const dates = games.map(r => r.game_date).filter(Boolean).sort();
  const splitDate = dates[Math.floor(dates.length / 2)];

  const train = rows.filter(r => (r.game_date || '9999-99-99') <= splitDate);
  const test = rows.filter(r => (r.game_date || '9999-99-99') > splitDate);

  const sTrain = summarize(train);
  const sTest = summarize(test);

  console.log('=== BeanBot OOS Split ===');
  console.log(`Dataset: ${file}`);
  console.log(`Split date (<= train): ${splitDate}`);
  console.log('');
  console.log('TRAIN', sTrain);
  console.log('TEST ', sTest);
}

main();

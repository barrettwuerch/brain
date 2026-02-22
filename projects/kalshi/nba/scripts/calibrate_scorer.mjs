#!/usr/bin/env node
/**
 * calibrate_scorer.mjs
 *
 * Reads data_full/dataset_*.jsonl and writes src/scorer_calibration.json
 * using empirical recovery rates per bucket.
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

function probBucket(p) {
  // Math.floor(entry_prob * 20) / 20 -> 0.40, 0.45, 0.50, etc.
  if (!Number.isFinite(p)) return null;
  return Math.floor(p * 20) / 20;
}

function deficitBucket(d) {
  if (!Number.isFinite(d)) return null;
  if (d <= 5) return 'low';
  if (d <= 10) return 'mid';
  if (d <= 15) return 'high';
  return 'blowout';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const outPath = args.out || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/scorer_calibration.json');

  const file = args.file || loadLatestDatasetFile(dir);
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const q = rows.filter(r => r.type === 'qualifying_event');

  const groups = new Map();
  for (const r of q) {
    const pb = probBucket(Number(r.entry_prob));
    const qb = Number(r.entry_quarter);
    const db = deficitBucket(Number(r.score_deficit));
    if (pb == null || ![1,2,3].includes(qb) || db == null) continue;

    const key = JSON.stringify({ prob_bucket: pb, quarter: qb, deficit_bucket: db });
    const g = groups.get(key) || { n: 0, recovered: 0, prob_bucket: pb, quarter: qb, deficit_bucket: db };
    g.n++;
    if (r.recovered_60 === true) g.recovered++;
    groups.set(key, g);
  }

  const out = {
    dataset_file: file,
    generated_at: new Date().toISOString(),
    grouping: {
      prob_bucket: 'floor(entry_prob*20)/20',
      quarter_bucket: 'entry_quarter (1,2,3)',
      deficit_bucket: 'low<=5, mid<=10, high<=15, blowout>15',
    },
    groups: Array.from(groups.values()).map(g => ({
      prob_bucket: g.prob_bucket,
      quarter: g.quarter,
      deficit_bucket: g.deficit_bucket,
      n: g.n,
      recovered: g.recovered,
      recovery_rate: g.n ? (g.recovered / g.n) : null,
    })),
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote calibration: ${outPath}`);
  console.log(`Groups: ${out.groups.length} from qualifying events: ${q.length}`);
}

main();

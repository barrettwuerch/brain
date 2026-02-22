/**
 * BeanBot Setup Scorer (Phase 2)
 *
 * score(entry_prob, entry_quarter, clock_remaining_sec, score_deficit, momentum_3min) -> 0..1
 *
 * Loads empirical recovery rates from scorer_calibration.json and turns them into
 * normalized component scores.
 */

import fs from 'node:fs';
import path from 'node:path';

let _cal = null;

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function probBucket(p) {
  if (!Number.isFinite(p)) return null;
  return Math.floor(p * 20) / 20;
}

function deficitBucket(d) {
  if (!Number.isFinite(d)) return 'blowout';
  if (d <= 5) return 'low';
  if (d <= 10) return 'mid';
  if (d <= 15) return 'high';
  return 'blowout';
}

function loadCalibration() {
  if (_cal) return _cal;
  const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), './scorer_calibration.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Build marginal rates (prob bucket, quarter, deficit bucket) by averaging over other dims.
  const prob = new Map();
  const qtr = new Map();
  const def = new Map();

  for (const g of raw.groups) {
    const rr = Number(g.recovery_rate);
    if (!Number.isFinite(rr)) continue;

    const pb = String(g.prob_bucket);
    const qb = String(g.quarter);
    const db = String(g.deficit_bucket);

    const add = (m, k) => {
      const cur = m.get(k) || { sum: 0, n: 0 };
      cur.sum += rr;
      cur.n += 1;
      m.set(k, cur);
    };

    add(prob, pb);
    add(qtr, qb);
    add(def, db);
  }

  const avgMap = (m) => {
    const out = {};
    for (const [k, v] of m.entries()) out[k] = v.sum / v.n;
    return out;
  };

  const probRates = avgMap(prob);
  const qtrRates = avgMap(qtr);
  const defRates = avgMap(def);

  const maxRate = (obj) => Math.max(...Object.values(obj));

  _cal = {
    raw,
    probRates,
    qtrRates,
    defRates,
    max: {
      prob: maxRate(probRates),
      qtr: maxRate(qtrRates),
      def: maxRate(defRates),
    },
  };

  return _cal;
}

function subWindowScore(entry_prob, cal) {
  const pb = probBucket(entry_prob);
  if (pb == null) return 0;
  const r = cal.probRates[String(pb)];
  if (!Number.isFinite(r)) return 0;
  return clamp01(r / cal.max.prob);
}

function quarterScore(entry_quarter, cal) {
  const q = Number(entry_quarter);
  if (![1,2,3].includes(q)) return 0;
  const r = cal.qtrRates[String(q)];
  if (!Number.isFinite(r)) return 0;
  return clamp01(r / cal.max.qtr);
}

function deficitScore(score_deficit, cal) {
  const db = deficitBucket(Number(score_deficit));
  if (db === 'blowout') return 0.1; // floor
  const r = cal.defRates[String(db)];
  if (!Number.isFinite(r)) return 0.1;
  return clamp01(r / cal.max.def);
}

function momentumScore(momentum_3min) {
  const m = Number(momentum_3min);
  if (!Number.isFinite(m)) return 0.5;
  if (m > -0.03) return 1.0;
  if (m > -0.08) return 0.6;
  return 0.2;
}

export function score({
  entry_prob,
  entry_quarter,
  clock_remaining_sec,
  score_deficit,
  momentum_3min,
} = {}) {
  const cal = loadCalibration();

  const sw = subWindowScore(entry_prob, cal);
  const q = quarterScore(entry_quarter, cal);
  const def = deficitScore(score_deficit, cal);
  const mom = momentumScore(momentum_3min);

  // weights: deficit has largest variance, prob window least.
  const composite = (sw * 0.20) + (q * 0.20) + (def * 0.40) + (mom * 0.20);
  return clamp01(composite);
}

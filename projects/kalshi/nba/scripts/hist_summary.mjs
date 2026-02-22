#!/usr/bin/env node
/**
 * hist_summary.mjs
 *
 * Usage:
 *   npm run hist:summary -- --dir ./data_full
 *   npm run hist:summary -- --file ./data_full/dataset_YYYY-MM-DD_xxx.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseArgs } from '../src/util.mjs';

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return (a.length % 2) ? a[m] : (a[m - 1] + a[m]) / 2;
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function pct(n, d) {
  if (!d) return null;
  return (n / d) * 100;
}

function quantizeEntryProb(p) {
  if (!Number.isFinite(p)) return null;
  if (p < 0.30 || p > 0.50) return null;
  if (p < 0.35) return '30-35';
  if (p < 0.40) return '35-40';
  if (p < 0.45) return '40-45';
  return '45-50';
}

function deficitBucket(d) {
  if (!Number.isFinite(d)) return null;
  if (d <= 5) return '1-5';
  if (d <= 10) return '6-10';
  if (d <= 15) return '11-15';
  return '15+';
}

function loadLatestDatasetFile(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('dataset_') && f.endsWith('.jsonl'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`No dataset_*.jsonl found in ${dir}`);
  return path.join(dir, files[0].f);
}

function entryElapsedSec(q, clockRemainingSec) {
  if (!Number.isFinite(q) || !Number.isFinite(clockRemainingSec)) return null;
  // ESPN period is 1..4, clockRemainingSec is seconds remaining in the quarter.
  const qLen = 12 * 60;
  return (q - 1) * qLen + (qLen - clockRemainingSec);
}

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function initBucketMap(keys) {
  const out = {};
  for (const k of keys) out[k] = { n: 0, recovered: 0 };
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const file = args.file || loadLatestDatasetFile(dir);

  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);

  const gamesSeen = new Set();
  const eligibleGames = new Set();

  let qualifyingEvents = 0;
  let eligibleQualifyingEvents = 0;

  let recoveredCount = 0;

  const byProb = initBucketMap(['30-35', '35-40', '40-45', '45-50']);
  const byQuarter = initBucketMap(['Q1', 'Q2', 'Q3']);
  const byDeficit = initBucketMap(['1-5', '6-10', '11-15', '15+']);

  const ttr = []; // seconds
  let recoveredBeforeQ4 = 0;
  let recoveredWithTtr = 0;

  const deficits = [];
  const pnl = []; // cents

  for (const ln of lines) {
    let o;
    try { o = JSON.parse(ln); } catch { continue; }
    const type = o.type;
    if (type !== 'qualifying_event' && type !== 'no_event') continue;

    const gameId = o.game_id;
    if (gameId) gamesSeen.add(gameId);

    const pre = safeNumber(o.pregame_prob);
    const isEligible = (pre != null && pre >= 0.65);
    if (gameId && isEligible) eligibleGames.add(gameId);

    if (type === 'qualifying_event') {
      qualifyingEvents++;
      if (isEligible) eligibleQualifyingEvents++;

      const rec = o.recovered_60 === true;
      if (rec) recoveredCount++;

      // prob bucket
      const p = safeNumber(o.entry_prob);
      const pb = quantizeEntryProb(p);
      if (pb) {
        byProb[pb].n++;
        if (rec) byProb[pb].recovered++;
      }

      // quarter bucket
      const q = safeNumber(o.entry_quarter);
      const qb = (q === 1) ? 'Q1' : (q === 2) ? 'Q2' : (q === 3) ? 'Q3' : null;
      if (qb) {
        byQuarter[qb].n++;
        if (rec) byQuarter[qb].recovered++;
      }

      // deficit bucket
      const d = safeNumber(o.score_deficit);
      if (d != null) deficits.push(d);
      const db = deficitBucket(d);
      if (db) {
        byDeficit[db].n++;
        if (rec) byDeficit[db].recovered++;
      }

      // time to recover
      const ttrSec = safeNumber(o.time_to_recover_sec);
      if (ttrSec != null) ttr.push(ttrSec);

      // recovered before Q4 check (only for recovered with non-null time_to_recover)
      if (rec && ttrSec != null) {
        const clockSec = safeNumber(o.entry_clock_sec);
        const entryEl = entryElapsedSec(q, clockSec);
        if (entryEl != null) {
          const recEl = entryEl + ttrSec;
          recoveredWithTtr++;
          if (recEl < 36 * 60) recoveredBeforeQ4++;
        }
      }

      // implied pnl
      const pc = safeNumber(o.implied_pnl_cents);
      if (pc != null) pnl.push(pc);
    }
  }

  const totalGames = gamesSeen.size;
  const eligible = eligibleGames.size;

  const recoveryRate = (qualifyingEvents ? recoveredCount / qualifyingEvents : null);

  const out = {
    dataset_file: file,

    headline: {
      total_games_processed: totalGames,
      eligible_games_pregame_ge_65: eligible,
      qualifying_events_found: qualifyingEvents,
      qualifying_events_in_eligible: eligibleQualifyingEvents,
    },

    recovery: {
      overall_recovery_rate: recoveryRate,
      overall_recovery_rate_pct: recoveryRate == null ? null : recoveryRate * 100,
    },

    recovery_by_entry_prob_window: Object.fromEntries(Object.entries(byProb).map(([k, v]) => {
      const r = v.n ? v.recovered / v.n : null;
      return [k, { n: v.n, recovered: v.recovered, recovery_rate: r, recovery_rate_pct: r == null ? null : r * 100 }];
    })),

    recovery_by_quarter: Object.fromEntries(Object.entries(byQuarter).map(([k, v]) => {
      const r = v.n ? v.recovered / v.n : null;
      return [k, { n: v.n, recovered: v.recovered, recovery_rate: r, recovery_rate_pct: r == null ? null : r * 100 }];
    })),

    recovery_speed: {
      time_to_recover_avg_sec: avg(ttr),
      time_to_recover_median_sec: median(ttr),
      time_to_recover_avg_min: avg(ttr) == null ? null : avg(ttr) / 60,
      time_to_recover_median_min: median(ttr) == null ? null : median(ttr) / 60,
      recovered_before_q4_pct: (recoveredWithTtr ? (recoveredBeforeQ4 / recoveredWithTtr) * 100 : null),
      recovered_before_q4_n: recoveredBeforeQ4,
      recovered_with_ttr_n: recoveredWithTtr,
    },

    deficit: {
      score_deficit_avg: avg(deficits),
      score_deficit_median: median(deficits),
      recovery_by_deficit_bucket: Object.fromEntries(Object.entries(byDeficit).map(([k, v]) => {
        const r = v.n ? v.recovered / v.n : null;
        return [k, { n: v.n, recovered: v.recovered, recovery_rate: r, recovery_rate_pct: r == null ? null : r * 100 }];
      })),
    },

    implied_pnl: {
      implied_pnl_avg_cents: avg(pnl),
      implied_pnl_median_cents: median(pnl),
      implied_pnl_best_cents: pnl.length ? Math.max(...pnl) : null,
      implied_pnl_worst_cents: pnl.length ? Math.min(...pnl) : null,
      implied_pnl_pct_positive: pnl.length ? pct(pnl.filter(x => x > 0).length, pnl.length) : null,
      n: pnl.length,
    },
  };

  // Print in a human readable format (but structured)
  console.log('=== BeanBot Historical Summary ===');
  console.log(`Dataset: ${out.dataset_file}`);
  console.log('');

  console.log('1) Denominators');
  console.log(`- Total games processed: ${out.headline.total_games_processed}`);
  console.log(`- Eligible games (pregame >= 65%): ${out.headline.eligible_games_pregame_ge_65}`);
  console.log(`- Qualifying events found: ${out.headline.qualifying_events_found}`);
  console.log(`- Qualifying events in eligible: ${out.headline.qualifying_events_in_eligible}`);
  console.log('');

  console.log('2) Overall recovery rate');
  console.log(`- Recovery rate: ${(out.recovery.overall_recovery_rate_pct ?? 0).toFixed(2)}%`);
  console.log('');

  console.log('3) Recovery rate by entry prob window');
  for (const k of ['30-35','35-40','40-45','45-50']) {
    const v = out.recovery_by_entry_prob_window[k];
    const pct = v.recovery_rate_pct;
    console.log(`- ${k}%: n=${v.n} recovered=${v.recovered} rate=${pct==null?'n/a':pct.toFixed(2)+'%'}`);
  }
  console.log('');

  console.log('4) Recovery rate by quarter');
  for (const k of ['Q1','Q2','Q3']) {
    const v = out.recovery_by_quarter[k];
    const pct = v.recovery_rate_pct;
    console.log(`- ${k}: n=${v.n} recovered=${v.recovered} rate=${pct==null?'n/a':pct.toFixed(2)+'%'}`);
  }
  console.log('');

  console.log('5) Recovery speed');
  const avgMin = out.recovery_speed.time_to_recover_avg_min;
  const medMin = out.recovery_speed.time_to_recover_median_min;
  console.log(`- Avg time to recover: ${avgMin==null?'n/a':avgMin.toFixed(2)} min`);
  console.log(`- Median time to recover: ${medMin==null?'n/a':medMin.toFixed(2)} min`);
  const bfq4 = out.recovery_speed.recovered_before_q4_pct;
  console.log(`- % recovered before Q4 (among recovered with ttr): ${bfq4==null?'n/a':bfq4.toFixed(2)}% (n=${out.recovery_speed.recovered_with_ttr_n})`);
  console.log('');

  console.log('6) Deficit');
  console.log(`- Avg deficit at entry: ${out.deficit.score_deficit_avg==null?'n/a':out.deficit.score_deficit_avg.toFixed(2)}`);
  console.log(`- Median deficit at entry: ${out.deficit.score_deficit_median==null?'n/a':out.deficit.score_deficit_median.toFixed(2)}`);
  console.log('- Recovery rate by deficit bucket:');
  for (const k of ['1-5','6-10','11-15','15+']) {
    const v = out.deficit.recovery_by_deficit_bucket[k];
    const pct = v.recovery_rate_pct;
    console.log(`  - ${k}: n=${v.n} recovered=${v.recovered} rate=${pct==null?'n/a':pct.toFixed(2)+'%'}`);
  }
  console.log('');

  console.log('7) Implied P&L (cents)');
  console.log(`- Avg: ${out.implied_pnl.implied_pnl_avg_cents==null?'n/a':out.implied_pnl.implied_pnl_avg_cents.toFixed(2)}¢`);
  console.log(`- Median: ${out.implied_pnl.implied_pnl_median_cents==null?'n/a':out.implied_pnl.implied_pnl_median_cents.toFixed(2)}¢`);
  console.log(`- Best: ${out.implied_pnl.implied_pnl_best_cents==null?'n/a':out.implied_pnl.implied_pnl_best_cents}¢`);
  console.log(`- Worst: ${out.implied_pnl.implied_pnl_worst_cents==null?'n/a':out.implied_pnl.implied_pnl_worst_cents}¢`);
  console.log(`- % positive: ${out.implied_pnl.implied_pnl_pct_positive==null?'n/a':out.implied_pnl.implied_pnl_pct_positive.toFixed(2)}% (n=${out.implied_pnl.n})`);
}

main();

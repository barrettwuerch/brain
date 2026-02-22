#!/usr/bin/env node
/**
 * exit_grid.mjs
 *
 * Grid search over (target, stop) and deficit-aware stop rules.
 * Constraints for candidate selection:
 * - n >= 30
 * - % positive >= 55%
 * - maximize avg pnl (cents)
 * Also prints per-quarter breakdown for each candidate.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, sleep } from '../src/util.mjs';
import { KalshiClient } from '../src/kalshi_client.mjs';

function loadLatestDatasetFile(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('dataset_') && f.endsWith('.jsonl'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`No dataset_*.jsonl found in ${dir}`);
  return path.join(dir, files[0].f);
}

function parseCandleResp(resp) {
  const cs = resp?.candlesticks || resp?.data?.candlesticks || resp?.data || [];
  return Array.isArray(cs) ? cs : [];
}

function candleMidProb(c) {
  const yb = c?.yes_bid?.close;
  const ya = c?.yes_ask?.close;
  if (Number.isFinite(yb) && Number.isFinite(ya)) return (yb + ya) / 2 / 100;
  const mean = c?.price?.mean;
  if (Number.isFinite(mean)) return mean / 100;
  const close = c?.price?.close;
  if (Number.isFinite(close)) return close / 100;
  return null;
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return (a.length % 2) ? a[m] : (a[m - 1] + a[m]) / 2;
}

function pct(n, d) {
  return d ? (n / d) * 100 : null;
}

function simulatePnlC({ entryProb, series, targetC, stopC, stopDisabled }) {
  const entryC = Math.round(entryProb * 100);

  for (const pt of series.slice(1)) {
    const c = Math.round(pt.prob * 100);
    if (c >= targetC) return { pnlC: targetC - entryC, reason: 'target' };
    if (!stopDisabled && c < stopC) return { pnlC: stopC - entryC, reason: 'stop' };
  }
  const maxC = Math.max(...series.map(pt => Math.round(pt.prob * 100)));
  return { pnlC: maxC - entryC, reason: 'max_after' };
}

function deficitBucket(d) {
  if (!Number.isFinite(d)) return null;
  if (d <= 5) return '1-5';
  if (d <= 10) return '6-10';
  if (d <= 15) return '11-15';
  return '15+';
}

function stopRuleFixed(stopC) {
  return (ev) => ({ action: 'trade', stopC, stopDisabled: false });
}

// Rule A: stop at 22 if deficit <=10 else stop at 20
function stopRuleA(ev) {
  const d = Number(ev.score_deficit);
  if (!Number.isFinite(d)) return { action: 'skip', reason: 'no_deficit' };
  return { action: 'trade', stopC: (d <= 10 ? 22 : 20), stopDisabled: false };
}

// Rule B: no stop until Q4 (not modeled precisely), so we disable stop when deficit <=8.
// NOTE: This is an approximation: we disable stop entirely.
function stopRuleB(ev) {
  const d = Number(ev.score_deficit);
  if (!Number.isFinite(d)) return { action: 'skip', reason: 'no_deficit' };
  if (d <= 8) return { action: 'trade', stopC: 0, stopDisabled: true };
  return { action: 'trade', stopC: 25, stopDisabled: false };
}

// Rule C: stop scales by deficit bucket, and skip deficit 15+
function stopRuleC(ev) {
  const d = Number(ev.score_deficit);
  if (!Number.isFinite(d)) return { action: 'skip', reason: 'no_deficit' };
  const b = deficitBucket(d);
  if (b === '15+') return { action: 'skip', reason: 'deficit_15_plus' };
  if (b === '1-5') return { action: 'trade', stopC: 25, stopDisabled: false };
  if (b === '6-10') return { action: 'trade', stopC: 22, stopDisabled: false };
  return { action: 'trade', stopC: 20, stopDisabled: false };
}

function quarterKey(q) {
  const n = Number(q);
  return (n === 1) ? 'Q1' : (n === 2) ? 'Q2' : (n === 3) ? 'Q3' : null;
}

function summarizePnls(arr) {
  const a = avg(arr);
  const m = median(arr);
  const pos = arr.filter(x => x > 0).length;
  return {
    n: arr.length,
    avg: a,
    median: m,
    best: arr.length ? Math.max(...arr) : null,
    worst: arr.length ? Math.min(...arr) : null,
    pctPos: arr.length ? (pos / arr.length) * 100 : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const file = args.file || loadLatestDatasetFile(dir);
  const windowHours = args.windowHours ? Number(args.windowHours) : 4;

  const targets = [60, 63, 65, 68];
  const fixedStops = [25, 22, 20, 17];

  const rules = [
    { name: 'fixed', variants: fixedStops.map(s => ({ label: `fixed_stop_${s}`, fn: stopRuleFixed(s) })) },
    { name: 'A', variants: [{ label: 'rule_A', fn: stopRuleA }] },
    { name: 'B', variants: [{ label: 'rule_B', fn: stopRuleB }] },
    { name: 'C', variants: [{ label: 'rule_C', fn: stopRuleC }] },
  ];

  // Kalshi client
  const projRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cfg = JSON.parse(fs.readFileSync(path.join(projRoot, 'config.paper.json'), 'utf8'));
  const keyId = fs.readFileSync(cfg.kalshi.keyIdPath, 'utf8').trim();
  const privateKeyPem = fs.readFileSync(cfg.kalshi.privateKeyPemPath, 'utf8');
  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });
  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  // Load qualifying events
  const events = [];
  for (const ln of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (o.type === 'qualifying_event') events.push(o);
  }

  console.log(`Dataset: ${file}`);
  console.log(`Qualifying events (rows): ${events.length}`);

  // Pre-fetch candle series for each event once.
  const seriesByKey = new Map();

  let fetched = 0;
  for (const ev of events) {
    const gameId = ev.game_id;
    const team = ev.favorite_team;
    const marketTicker = `${gameId}-${team}`;
    const entryTs = Number(ev.entry_ts);
    const start_ts = String(entryTs);
    const end_ts = String(entryTs + Math.floor(windowHours * 3600));

    let resp;
    try {
      resp = await client.getCandlesticksAuto(seriesTicker, marketTicker, { start_ts, end_ts, period_interval: '1' });
    } catch {
      continue;
    }
    const cs = parseCandleResp(resp)
      .map(c => ({ tSec: Number(c.end_period_ts), prob: candleMidProb(c) }))
      .filter(x => Number.isFinite(x.tSec) && x.prob != null)
      .filter(x => x.tSec >= entryTs);
    if (cs.length < 2) continue;

    seriesByKey.set(marketTicker + '@' + entryTs, cs);
    fetched++;
    if (fetched % 25 === 0) console.log(`...fetched series ${fetched}/${events.length}`);
    await sleep(40);
  }

  // Evaluate grid
  const rows = [];

  for (const tgtC of targets) {
    for (const ruleGroup of rules) {
      for (const v of ruleGroup.variants) {
        const pnls = [];
        const pnlsByQ = { Q1: [], Q2: [], Q3: [] };

        for (const ev of events) {
          const gameId = ev.game_id;
          const team = ev.favorite_team;
          const marketTicker = `${gameId}-${team}`;
          const entryTs = Number(ev.entry_ts);
          const key = marketTicker + '@' + entryTs;
          const series = seriesByKey.get(key);
          if (!series) continue;

          const stopDecision = v.fn(ev);
          if (stopDecision.action === 'skip') continue;

          const sim = simulatePnlC({
            entryProb: Number(ev.entry_prob),
            series,
            targetC: tgtC,
            stopC: stopDecision.stopC,
            stopDisabled: stopDecision.stopDisabled,
          });

          pnls.push(sim.pnlC);
          const qk = quarterKey(ev.entry_quarter);
          if (qk && pnlsByQ[qk]) pnlsByQ[qk].push(sim.pnlC);
        }

        const s = summarizePnls(pnls);
        const sQ = {
          Q1: summarizePnls(pnlsByQ.Q1),
          Q2: summarizePnls(pnlsByQ.Q2),
          Q3: summarizePnls(pnlsByQ.Q3),
        };

        rows.push({
          targetC: tgtC,
          stopRule: v.label,
          ...s,
          byQuarter: sQ,
        });
      }
    }
  }

  // Filter to viable
  const viable = rows.filter(r => r.n >= 30 && (r.pctPos ?? 0) >= 55);
  viable.sort((a, b) => (b.avg ?? -1e9) - (a.avg ?? -1e9));

  const best = viable[0] || null;

  console.log('\n=== Grid search (viable candidates: n>=30 & %pos>=55) ===');
  console.log(`Candidates: ${viable.length}`);
  console.log('Top 10 by avg pnl:');
  for (const r of viable.slice(0, 10)) {
    console.log(
      `target=${r.targetC} stop=${r.stopRule}  n=${r.n}  avg=${r.avg.toFixed(2)}¢  med=${r.median.toFixed(2)}¢  %pos=${r.pctPos.toFixed(2)}%`
    );
  }

  if (best) {
    console.log('\n=== Best candidate (by avg pnl, under constraints) ===');
    console.log(JSON.stringify(best, null, 2));

    // Consistency check across quarters: flag if any quarter has n>=10 and avg<0
    const flags = [];
    for (const q of ['Q1','Q2','Q3']) {
      const s = best.byQuarter[q];
      if (s.n >= 10 && s.avg < 0) flags.push(`${q}_avg_negative`);
    }
    if (flags.length) {
      console.log('WARNING: quarter consistency flags:', flags.join(', '));
    }
  } else {
    console.log('\nNo candidate met constraints.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });

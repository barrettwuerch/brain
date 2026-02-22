#!/usr/bin/env node
/**
 * exit_optimize.mjs
 *
 * Tests alternative exit targets on the completed dataset by re-simulating exits from
 * the actual candlestick timeline after entry.
 *
 * Uses qualifying_event rows from dataset_*.jsonl in a given dir.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseArgs } from '../src/util.mjs';
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

function simulate({ entryProb, series, targetProb, stopProb }) {
  // series: [{tSec, prob}...] from entry inclusive
  const entryC = Math.round(entryProb * 100);
  const tgtC = Math.round(targetProb * 100);
  const stpC = Math.round(stopProb * 100);

  for (const pt of series.slice(1)) {
    const c = Math.round(pt.prob * 100);
    if (c >= tgtC) return { exitC: tgtC, reason: 'target', pnlC: tgtC - entryC };
    if (c < stpC) return { exitC: stpC, reason: 'stop', pnlC: stpC - entryC };
  }
  const maxC = Math.max(...series.map(pt => Math.round(pt.prob * 100)));
  return { exitC: maxC, reason: 'max_after', pnlC: maxC - entryC };
}

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const file = args.file || loadLatestDatasetFile(dir);

  const targets = (args.targets ? String(args.targets).split(',').map(Number) : [0.60, 0.63, 0.65, 0.68]);
  const stop = args.stop ? Number(args.stop) : 0.25;
  const windowHours = args.windowHours ? Number(args.windowHours) : 4;

  // Kalshi credentials via config.paper.json in project root
  const projRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cfg = JSON.parse(fs.readFileSync(path.join(projRoot, 'config.paper.json'), 'utf8'));

  const keyId = fs.readFileSync(cfg.kalshi.keyIdPath, 'utf8').trim();
  const privateKeyPem = fs.readFileSync(cfg.kalshi.privateKeyPemPath, 'utf8');
  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });
  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  // Load qualifying events
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const ln of lines) {
    let o;
    try { o = JSON.parse(ln); } catch { continue; }
    if (o.type === 'qualifying_event') events.push(o);
  }

  console.log(`Dataset: ${file}`);
  console.log(`Qualifying events: ${events.length}`);
  console.log(`Targets: ${targets.join(', ')} stop=${stop}`);

  const results = {};
  for (const t of targets) results[t] = [];

  // Simulate per event
  let i = 0;
  for (const ev of events) {
    i++;
    const gameId = ev.game_id;
    const team = ev.favorite_team;
    const marketTicker = `${gameId}-${team}`;

    const entryTs = Number(ev.entry_ts);
    const start_ts = String(entryTs);
    const end_ts = String(entryTs + Math.floor(windowHours * 3600));

    // Fetch 1-min candles from entry onward
    let resp;
    try {
      resp = await client.getCandlesticksAuto(seriesTicker, marketTicker, {
        start_ts,
        end_ts,
        period_interval: '1',
      });
    } catch (e) {
      // Skip if unavailable
      continue;
    }
    const cs = parseCandleResp(resp)
      .map(c => ({ tSec: Number(c.end_period_ts), prob: candleMidProb(c) }))
      .filter(x => Number.isFinite(x.tSec) && x.prob != null)
      .filter(x => x.tSec >= entryTs);

    if (cs.length < 2) continue;

    for (const tgt of targets) {
      const sim = simulate({ entryProb: Number(ev.entry_prob), series: cs, targetProb: tgt, stopProb: stop });
      results[tgt].push(sim.pnlC);
    }

    if (i % 25 === 0) {
      console.log(`...simulated ${i}/${events.length}`);
    }
  }

  // Print summary table
  console.log('\n=== Exit optimization results (pnl in cents per contract) ===');
  for (const tgt of targets) {
    const arr = results[tgt];
    const a = avg(arr);
    const m = median(arr);
    const pos = arr.filter(x => x > 0).length;
    console.log(`target=${Math.round(tgt*100)}¢  n=${arr.length}  avg=${a==null?'n/a':a.toFixed(2)}¢  median=${m==null?'n/a':m.toFixed(2)}¢  best=${arr.length?Math.max(...arr):'n/a'}¢  worst=${arr.length?Math.min(...arr):'n/a'}¢  %pos=${arr.length?((pos/arr.length)*100).toFixed(2):'n/a'}%`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * exit_prod_ev.mjs
 *
 * Production-config EV sim:
 * - Entry: already encoded in qualifying_event rows.
 * - Exit target: 68c
 * - Stop logic: Rule B (no stop if deficit<=8; else stop at 25c)
 * - Forced close: Q4 0:30 remaining (or last observed Q4 candle)
 * - Intra-candle ambiguity: if BOTH target and stop hit in same 1-min candle, assume STOP happens first.
 */

import fs from 'node:fs';
import path from 'node:path';

import { KalshiClient } from '../src/kalshi_client.mjs';
import { parseArgs, sleep } from '../src/util.mjs';
import { fetchEspnNbaScoreboard } from '../src/espn_scoreboard.mjs';
import { fetchEspnNbaSummary, buildStateTimelineFromSummary, stateAtOrBefore } from '../src/espn_summary.mjs';
import { parseNbaEventTicker } from '../src/nba_ticker_parse.mjs';

function loadLatestDatasetFile(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('dataset_') && f.endsWith('.jsonl'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`No dataset_*.jsonl found in ${dir}`);
  return path.join(dir, files[0].f);
}

function parseCandleResp(resp) {
  return (resp?.candlesticks || resp?.data?.candlesticks || resp?.data || []);
}

function candleProbCloseC(c) {
  const v = c?.price?.close;
  if (Number.isFinite(v)) return v;
  const m = c?.price?.mean;
  if (Number.isFinite(m)) return Math.round(m);
  return null;
}

function candleHighLowC(c) {
  const hi = c?.price?.high;
  const lo = c?.price?.low;
  return {
    hi: Number.isFinite(hi) ? hi : null,
    lo: Number.isFinite(lo) ? lo : null,
  };
}

function avg(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return (a.length % 2) ? a[m] : (a[m - 1] + a[m]) / 2;
}

function simulatePnl({ entryC, candles, targetC, stopC, stopDisabled, cutoffIndex }) {
  const end = (cutoffIndex != null) ? Math.min(candles.length, cutoffIndex + 1) : candles.length;

  for (let i = 1; i < end; i++) {
    const { hi, lo } = candleHighLowC(candles[i]);

    const hitTarget = (hi != null) ? (hi >= targetC) : false;
    const hitStop = (!stopDisabled && lo != null) ? (lo < stopC) : false;

    if (hitTarget && hitStop) {
      // Conservative: assume stop triggers first within the bar.
      return { pnlC: stopC - entryC, reason: 'ambiguous_stop_first', exitIndex: i };
    }
    if (hitTarget) return { pnlC: targetC - entryC, reason: 'target', exitIndex: i };
    if (hitStop) return { pnlC: stopC - entryC, reason: 'stop', exitIndex: i };
  }

  // forced close at cutoff
  if (cutoffIndex != null && cutoffIndex >= 0 && cutoffIndex < candles.length) {
    const closeC = candleProbCloseC(candles[cutoffIndex]);
    if (closeC != null) return { pnlC: closeC - entryC, reason: 'q4_cutoff', exitIndex: cutoffIndex };
    return { pnlC: 0, reason: 'q4_cutoff_missing_close', exitIndex: cutoffIndex };
  }

  // fallback: close at max close
  let maxC = null;
  for (let i = 1; i < end; i++) {
    const c = candleProbCloseC(candles[i]);
    if (c == null) continue;
    if (maxC == null || c > maxC) maxC = c;
  }
  return { pnlC: (maxC ?? entryC) - entryC, reason: 'max_close_after', exitIndex: end - 1 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const file = args.file || loadLatestDatasetFile(dir);

  const TARGET_C = 68;
  const STOP_C = 25;
  const Q4_CUTOFF_SEC = 30;
  const windowHours = args.windowHours ? Number(args.windowHours) : 4;

  const projRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cfg = JSON.parse(fs.readFileSync(path.join(projRoot, 'config.paper.json'), 'utf8'));
  const keyId = fs.readFileSync(cfg.kalshi.keyIdPath, 'utf8').trim();
  const privateKeyPem = fs.readFileSync(cfg.kalshi.privateKeyPemPath, 'utf8');
  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });
  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  const events = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    .map(l => JSON.parse(l))
    .filter(o => o.type === 'qualifying_event');

  const toEspn = (a) => ({ GSW: 'GS', SAS: 'SA', NOP: 'NO', NYK: 'NY' }[a] || a);
  const sbCache = new Map();
  const tlCache = new Map();

  async function getTimeline(gameId) {
    const p = parseNbaEventTicker(gameId);
    if (!p?.ok) return null;

    let sb = sbCache.get(p.date);
    if (!sb) { sb = await fetchEspnNbaScoreboard({ isoDate: p.date }); sbCache.set(p.date, sb); }
    const g = sb.games.find(x => x.awayAbbr === toEspn(p.away) && x.homeAbbr === toEspn(p.home));
    const eventId = g?.espnEventId;
    if (!eventId) return null;

    if (tlCache.has(eventId)) return tlCache.get(eventId);
    const sum = await fetchEspnNbaSummary({ eventId });
    const tl = buildStateTimelineFromSummary(sum);
    tlCache.set(eventId, tl);
    return tl;
  }

  function findCutoffIndex(candles, tl) {
    if (!tl) return null;
    let lastQ4 = null;
    for (let i = 0; i < candles.length; i++) {
      const tSec = Number(candles[i].end_period_ts);
      const st = stateAtOrBefore(tl, tSec);
      if (st?.period === 4) {
        lastQ4 = i;
        if (Number.isFinite(st.clockSec) && st.clockSec <= Q4_CUTOFF_SEC) return i;
      }
    }
    return lastQ4;
  }

  const pnls = [];
  const reasons = {};
  let prepared = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const gameId = ev.game_id;
    const marketTicker = `${gameId}-${ev.favorite_team}`;
    const entryTs = Number(ev.entry_ts);
    const entryC = Math.round(Number(ev.entry_prob) * 100);

    const deficit = Number(ev.score_deficit);
    const stopDisabled = Number.isFinite(deficit) && deficit <= 8;

    let resp;
    try {
      resp = await client.getCandlesticksAuto(seriesTicker, marketTicker, {
        start_ts: String(entryTs),
        end_ts: String(entryTs + Math.floor(windowHours * 3600)),
        period_interval: '1',
      });
    } catch {
      continue;
    }

    const candles = parseCandleResp(resp).filter(c => Number.isFinite(Number(c?.end_period_ts)) && Number(c.end_period_ts) >= entryTs);
    if (candles.length < 2) continue;

    const tl = await getTimeline(gameId);
    const cut = findCutoffIndex(candles, tl);

    const sim = simulatePnl({ entryC, candles, targetC: TARGET_C, stopC: STOP_C, stopDisabled, cutoffIndex: cut });
    pnls.push(sim.pnlC);
    reasons[sim.reason] = (reasons[sim.reason] || 0) + 1;

    prepared++;
    if (prepared % 25 === 0) console.log(`...sim ${prepared}/${events.length}`);
    await sleep(25);
  }

  const pos = pnls.filter(x => x > 0).length;

  console.log('=== Production config EV (conservative intra-candle ordering) ===');
  console.log(`Dataset: ${file}`);
  console.log(`n=${pnls.length}`);
  console.log(`avg=${avg(pnls).toFixed(2)}¢  median=${median(pnls).toFixed(2)}¢  best=${Math.max(...pnls)}¢  worst=${Math.min(...pnls)}¢  %pos=${(pos/pnls.length*100).toFixed(2)}%`);
  console.log('reasons:', reasons);
}

main().catch(e => { console.error(e); process.exit(1); });

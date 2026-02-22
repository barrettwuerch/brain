#!/usr/bin/env node
/**
 * exit_q4_cutoffs.mjs
 *
 * Evaluate Target 68 + Rule B with various Q4 forced-close times.
 *
 * Rule B:
 *   if score_deficit <= 8: no stop (until forced-close)
 *   else: stop at 25c
 *
 * We model forced close at a specific Q4 clock remaining threshold:
 *   12:00, 9:00, 6:00, 3:00, 0:30
 *
 * Output includes EV, % positive, and % of Q4 recoveries captured before each cutoff.
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

function avg(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return (a.length % 2) ? a[m] : (a[m - 1] + a[m]) / 2;
}

function simulate({ entryProb, series, targetC, stopC, stopDisabled, cutoffIndex }) {
  const entryC = Math.round(entryProb * 100);

  const end = (cutoffIndex != null) ? Math.min(series.length, cutoffIndex + 1) : series.length;
  const s = series.slice(0, end);

  for (let i = 1; i < s.length; i++) {
    const c = Math.round(s[i].prob * 100);
    if (c >= targetC) return { pnlC: targetC - entryC, reason: 'target', hitIndex: i };
    if (!stopDisabled && c < stopC) return { pnlC: stopC - entryC, reason: 'stop', hitIndex: i };
  }

  // forced close at cutoff
  if (cutoffIndex != null && cutoffIndex >= 0 && cutoffIndex < series.length) {
    const c = Math.round(series[cutoffIndex].prob * 100);
    return { pnlC: c - entryC, reason: 'q4_cutoff', hitIndex: cutoffIndex };
  }

  const maxC = Math.max(...s.map(pt => Math.round(pt.prob * 100)));
  return { pnlC: maxC - entryC, reason: 'max_after', hitIndex: s.length - 1 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const file = args.file || loadLatestDatasetFile(dir);

  const targetC = 68;
  const stopDefaultC = 25;
  const windowHours = args.windowHours ? Number(args.windowHours) : 4;

  const cutoffs = [
    { label: 'Q4_12:00', remainingSec: 12 * 60 },
    { label: 'Q4_9:00', remainingSec: 9 * 60 },
    { label: 'Q4_6:00', remainingSec: 6 * 60 },
    { label: 'Q4_3:00', remainingSec: 3 * 60 },
    { label: 'Q4_0:30', remainingSec: 30 },
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

  // ESPN caches
  const sbCache = new Map(); // isoDate -> scoreboard
  const summaryTimelineCache = new Map(); // eventId -> timeline
  const toEspn = (a) => ({ GSW: 'GS', SAS: 'SA', NOP: 'NO', NYK: 'NY' }[a] || a);

  async function getEspnEventId(gameId) {
    const p = parseNbaEventTicker(gameId);
    if (!p?.ok) return null;
    let sb = sbCache.get(p.date);
    if (!sb) { sb = await fetchEspnNbaScoreboard({ isoDate: p.date }); sbCache.set(p.date, sb); }
    const g = sb.games.find(x => x.awayAbbr === toEspn(p.away) && x.homeAbbr === toEspn(p.home));
    return g?.espnEventId || null;
  }

  async function getTimeline(eventId) {
    if (summaryTimelineCache.has(eventId)) return summaryTimelineCache.get(eventId);
    const sum = await fetchEspnNbaSummary({ eventId });
    const tl = buildStateTimelineFromSummary(sum);
    summaryTimelineCache.set(eventId, tl);
    return tl;
  }

  // Pre-fetch series + timeline per event once
  const prepared = [];
  let fetched = 0;
  for (const ev of events) {
    const gameId = ev.game_id;
    const team = ev.favorite_team;
    const marketTicker = `${gameId}-${team}`;
    const entryTs = Number(ev.entry_ts);

    const deficit = Number(ev.score_deficit);
    const stopDisabled = Number.isFinite(deficit) && deficit <= 8;
    const stopC = stopDisabled ? 0 : stopDefaultC;

    const start_ts = String(entryTs);
    const end_ts = String(entryTs + Math.floor(windowHours * 3600));

    let series;
    try {
      const resp = await client.getCandlesticksAuto(seriesTicker, marketTicker, { start_ts, end_ts, period_interval: '1' });
      series = parseCandleResp(resp)
        .map(c => ({ tSec: Number(c.end_period_ts), prob: candleMidProb(c) }))
        .filter(x => Number.isFinite(x.tSec) && x.prob != null)
        .filter(x => x.tSec >= entryTs);
    } catch {
      continue;
    }
    if (!series || series.length < 2) continue;

    let tl = null;
    try {
      const eventId = await getEspnEventId(gameId);
      if (eventId) tl = await getTimeline(eventId);
    } catch {
      tl = null;
    }

    prepared.push({ ev, series, timeline: tl, stopDisabled, stopC });
    fetched++;
    if (fetched % 25 === 0) console.log(`...prepared ${fetched}/${events.length}`);
    await sleep(40);
  }

  function findCutoffIndex(series, tl, cutoffRemainingSec) {
    if (!tl) return null;

    // Find first candle that is in Q4 with clockSec <= cutoffRemainingSec.
    // If we never observe clockSec <= cutoff (e.g., no plays in the final 30s),
    // fall back to the last candle we can confirm is in Q4.
    let lastQ4 = null;
    for (let i = 0; i < series.length; i++) {
      const st = stateAtOrBefore(tl, series[i].tSec);
      if (st?.period === 4) {
        lastQ4 = i;
        if (Number.isFinite(st.clockSec) && st.clockSec <= cutoffRemainingSec) {
          return i;
        }
      }
    }
    return lastQ4;
  }

  function findFirstTargetHitIndex(series, targetCents) {
    for (let i = 1; i < series.length; i++) {
      const c = Math.round(series[i].prob * 100);
      if (c >= targetCents) return i;
    }
    return null;
  }

  console.log(`Dataset: ${file}`);
  console.log(`Qualifying events: ${events.length} (prepared=${prepared.length})`);
  console.log(`Config: target=${targetC}¢ RuleB(stop disabled if deficit<=8 else stop=25¢)`);
  console.log('');

  // Determine which events "recover in Q4" (hit target at some point in Q4)
  const q4Recoverables = [];
  for (const p of prepared) {
    if (!p.timeline) continue;
    const hit = findFirstTargetHitIndex(p.series, targetC);
    if (hit == null) continue;
    const stHit = stateAtOrBefore(p.timeline, p.series[hit].tSec);
    if (stHit?.period === 4) {
      q4Recoverables.push({ prepared: p, hitIndex: hit, stHit });
    }
  }

  for (const c of cutoffs) {
    const pnls = [];
    let pos = 0;

    let q4Captured = 0;

    for (const p of prepared) {
      const cutIdx = findCutoffIndex(p.series, p.timeline, c.remainingSec);
      const sim = simulate({ entryProb: Number(p.ev.entry_prob), series: p.series, targetC, stopC: p.stopC, stopDisabled: p.stopDisabled, cutoffIndex: cutIdx });
      pnls.push(sim.pnlC);
      if (sim.pnlC > 0) pos++;
    }

    // % of Q4 recoveries captured before cutoff
    for (const item of q4Recoverables) {
      const p = item.prepared;
      const cutIdx = findCutoffIndex(p.series, p.timeline, c.remainingSec);
      if (cutIdx == null) continue; // if we never reach that late in Q4, ignore
      if (item.hitIndex <= cutIdx) {
        // hit target before forced close time
        q4Captured++;
      }
    }

    const a = avg(pnls);
    const m = median(pnls);
    const best = Math.max(...pnls);
    const worst = Math.min(...pnls);
    const pctPos = (pos / pnls.length) * 100;

    const q4Total = q4Recoverables.length;
    const q4Pct = q4Total ? (q4Captured / q4Total) * 100 : null;

    console.log(`=== ${c.label} forced close (clock <= ${c.remainingSec}s) ===`);
    console.log(`n=${pnls.length}  avg=${a.toFixed(2)}¢  med=${m.toFixed(2)}¢  best=${best}¢  worst=${worst}¢  %pos=${pctPos.toFixed(2)}%`);
    console.log(`q4_recoveries_captured_before_cutoff: ${q4Total? q4Captured+'/'+q4Total : 'n/a'} (${q4Pct==null?'n/a':q4Pct.toFixed(2)+'%'})`);
    console.log('');
  }
}

main().catch(e => { console.error(e); process.exit(1); });

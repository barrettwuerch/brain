#!/usr/bin/env node
/**
 * backtest_50k.mjs
 *
 * Simulates BeanBot over qualifying_event rows using:
 * - $50k starting capital
 * - scorer gating + sizing
 * - risk gates (daily/weekly/hard stop)
 * - P&L from dataset field implied_pnl_cents (per contract)
 *
 * Writes:
 * - data_full/backtest_trades.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseArgs } from '../src/util.mjs';
import { score as scoreFn } from '../src/scorer.mjs';
import { KalshiClient } from '../src/kalshi_client.mjs';
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

function isoMonth(isoDate) {
  return String(isoDate).slice(0, 7);
}

function isMonday(isoDate) {
  // isoDate: YYYY-MM-DD (treat as UTC midnight for consistency)
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.getUTCDay() === 1;
}

function avg(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }

function pct(n, d) { return d ? (n / d) * 100 : null; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const datasetFile = args.file || loadLatestDatasetFile(dir);

  const startingCapital = 50000;
  const sizingMode = String(args.sizing || 'flat'); // flat|tiered|pct-tiered|kelly
  const kellyFraction = args['kelly-fraction'] ? Number(args['kelly-fraction']) : 0.5;
  const kellyCap = args['kelly-cap'] ? Number(args['kelly-cap']) : 0.05;

  const exitMode = String(args.exit || 'baseline'); // baseline|split-exit
  const splitPct = args['split-pct'] ? Number(args['split-pct']) : 0.5;
  const compareSplit = String(args['compare-split'] || 'false') === 'true';

  // Production exit rule params
  const TARGET_C = 68;
  const STOP_C = 25;
  const Q4_CUTOFF_SEC = 30;
  const WINDOW_HOURS = 4;

  // Kalshi client + secrets via config
  const projRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cfg = JSON.parse(fs.readFileSync(path.join(projRoot, 'config.paper.json'), 'utf8'));
  const keyId = fs.readFileSync(cfg.kalshi.keyIdPath, 'utf8').trim();
  const privateKeyPem = fs.readFileSync(cfg.kalshi.privateKeyPemPath, 'utf8');
  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });
  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  // caches
  const pnlCacheFile = path.join(dir, 'prod_pnl_cache.json');
  const pnlCache = fs.existsSync(pnlCacheFile) ? JSON.parse(fs.readFileSync(pnlCacheFile, 'utf8')) : {};
  const sbCache = new Map(); // isoDate -> scoreboard
  const tlCache = new Map(); // eventId -> timeline
  let capital = startingCapital;
  let weekStartCapital = startingCapital;
  let dailyDeployed = 0;
  let currentDate = null;
  let weekPaused = false;

  const outTrades = path.join(dir, 'backtest_trades.jsonl');
  if (fs.existsSync(outTrades)) fs.unlinkSync(outTrades);

  const rows = fs.readFileSync(datasetFile, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const events = rows.filter(r => r.type === 'qualifying_event')
    .sort((a, b) => (a.game_date < b.game_date ? -1 : a.game_date > b.game_date ? 1 : (a.game_id < b.game_id ? -1 : 1)));

  function parseCandles(resp) {
    return (resp?.candlesticks || resp?.data?.candlesticks || resp?.data || []);
  }

  function candleHighLowC(c) {
    const hi = c?.price?.high;
    const lo = c?.price?.low;
    return { hi: Number.isFinite(hi) ? hi : null, lo: Number.isFinite(lo) ? lo : null };
  }

  function candleCloseC(c) {
    const cl = c?.price?.close;
    return Number.isFinite(cl) ? cl : null;
  }

  async function getTimeline(gameId) {
    const p = parseNbaEventTicker(gameId);
    if (!p?.ok) return null;

    let sb = sbCache.get(p.date);
    if (!sb) {
      sb = await fetchEspnNbaScoreboard({ isoDate: p.date });
      sbCache.set(p.date, sb);
    }

    const toEspn = (a) => ({ GSW: 'GS', SAS: 'SA', NOP: 'NO', NYK: 'NY' }[a] || a);
    const g = sb.games.find(x => x.awayAbbr === toEspn(p.away) && x.homeAbbr === toEspn(p.home));
    const eventId = g?.espnEventId;
    if (!eventId) return null;

    if (tlCache.has(eventId)) return { tl: tlCache.get(eventId), parsed: p };
    const sum = await fetchEspnNbaSummary({ eventId });
    const tl = buildStateTimelineFromSummary(sum);
    tlCache.set(eventId, tl);
    return { tl, parsed: p };
  }

  function findQ4CutoffIndex(candles, tl) {
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

  function feesOnWinningsCentsPerContract(entryC, exitC, feeRate=0.01) {
    const gross = exitC - entryC;
    const winnings = Math.max(0, gross);
    return winnings * feeRate;
  }

  function simulateProdExitSingle({ entryC, candles, stopDisabled, cutoffIndex, feeRate=0.01 }) {
    const end = (cutoffIndex != null) ? Math.min(candles.length, cutoffIndex + 1) : candles.length;

    for (let i = 1; i < end; i++) {
      const { hi, lo } = candleHighLowC(candles[i]);
      const hitT = (hi != null) && (hi >= TARGET_C);
      const hitS = (!stopDisabled) && (lo != null) && (lo < STOP_C);

      let exitC = null;
      let reason = null;

      if (hitT && hitS) { exitC = STOP_C; reason = 'stop_loss'; }
      else if (hitT) { exitC = TARGET_C; reason = 'target_hit'; }
      else if (hitS) { exitC = STOP_C; reason = 'stop_loss'; }

      if (exitC != null) {
        const feeC = feesOnWinningsCentsPerContract(entryC, exitC, feeRate);
        return { pnlC: (exitC - entryC) - feeC, exitC, reason };
      }
    }

    if (cutoffIndex != null && cutoffIndex >= 0 && cutoffIndex < candles.length) {
      const closeC = candleCloseC(candles[cutoffIndex]);
      const exitC = (closeC != null) ? closeC : entryC;
      const feeC = feesOnWinningsCentsPerContract(entryC, exitC, feeRate);
      return { pnlC: (exitC - entryC) - feeC, exitC, reason: 'q4_cutoff' };
    }

    return { pnlC: 0, exitC: entryC, reason: 'no_exit' };
  }

  function simulateProdExitSplit({ entryC, candles, stopDisabled, cutoffIndex, splitPct=0.5, feeRate=0.01 }) {
    // Split only if 2x entry is below target ceiling (entry < 34c).
    const splitPriceC = entryC * 2;
    if (!(splitPriceC < TARGET_C)) {
      const single = simulateProdExitSingle({ entryC, candles, stopDisabled, cutoffIndex, feeRate });
      return { ...single, split_fired: false, split_price: null };
    }

    const end = (cutoffIndex != null) ? Math.min(candles.length, cutoffIndex + 1) : candles.length;

    let splitFired = false;
    let splitAtC = null;
    let splitIndex = null;

    // 1) Find split trigger time (conservative: if stop+split both hit same bar and stop enabled, assume stop first => no split)
    for (let i = 1; i < end; i++) {
      const { hi, lo } = candleHighLowC(candles[i]);
      const hitSplit = (hi != null) && (hi >= splitPriceC);
      const hitStop = (!stopDisabled) && (lo != null) && (lo < STOP_C);

      if (hitStop && hitSplit) {
        // stop-first ambiguity => treat as stop before split
        break;
      }
      if (hitStop) break;
      if (hitSplit) {
        splitFired = true;
        splitAtC = splitPriceC;
        splitIndex = i;
        break;
      }
    }

    if (!splitFired) {
      const single = simulateProdExitSingle({ entryC, candles, stopDisabled, cutoffIndex, feeRate });
      return { ...single, split_fired: false, split_price: splitPriceC };
    }

    // Leg 1: partial exit
    const fee1 = feesOnWinningsCentsPerContract(entryC, splitAtC, feeRate);
    const leg1PnlC = (splitAtC - entryC) - fee1;

    // Leg 2: continue from splitIndex
    const remainingCandles = [{ dummy:true }, ...candles.slice(splitIndex)];
    // For remainder, entryC remains original entryC.
    const rem = simulateProdExitSingle({ entryC, candles: remainingCandles, stopDisabled, cutoffIndex: null, feeRate });

    const totalPnlC = (leg1PnlC * splitPct) + (rem.pnlC * (1 - splitPct));

    return {
      pnlC: totalPnlC,
      exitC: rem.exitC,
      reason: rem.reason,
      split_fired: true,
      split_price: splitAtC,
      remainder_exit_reason: rem.reason,
      remainder_exit_price: rem.exitC,
    };
  }

  async function prodPnlForEvent(ev) {
    const gameId = ev.game_id;
    const fav = ev.favorite_team;
    const entryTs = Number(ev.entry_ts);
    const cacheKey = `${gameId}|${fav}|${entryTs}`;

    if (cacheKey in pnlCache) {
      const cached = pnlCache[cacheKey];
      // Normalize old-style number cache entries to expected object format
      if (typeof cached === 'number') return { pnlC: cached };
      return cached;
    }

    const marketTicker = `${gameId}-${fav}`;
    const start_ts = String(entryTs);
    const end_ts = String(entryTs + WINDOW_HOURS * 3600);

    let resp;
    try {
      resp = await client.getCandlesticksAuto(seriesTicker, marketTicker, { start_ts, end_ts, period_interval: '1' });
    } catch {
      pnlCache[cacheKey] = null;
      return null;
    }

    const candles = parseCandles(resp).filter(c => Number(c?.end_period_ts) >= entryTs);
    if (candles.length < 2) {
      pnlCache[cacheKey] = null;
      return null;
    }

    const tlInfo = await getTimeline(gameId);
    const tl = tlInfo?.tl || null;
    const cut = findQ4CutoffIndex(candles, tl);

    // Rule B stop disabled if deficit <= 8 at entry
    const deficit = Number(ev.score_deficit);
    const stopDisabled = Number.isFinite(deficit) && deficit <= 8;

    const entryC = Math.round(Number(ev.entry_prob) * 100);
    const feeRate = 0.01;

    const out = (exitMode === 'split-exit')
      ? simulateProdExitSplit({ entryC, candles, stopDisabled, cutoffIndex: cut, splitPct, feeRate })
      : simulateProdExitSingle({ entryC, candles, stopDisabled, cutoffIndex: cut, feeRate });

    pnlCache[cacheKey] = out;
    // persist occasionally
    if (Object.keys(pnlCache).length % 25 === 0) {
      fs.writeFileSync(pnlCacheFile, JSON.stringify(pnlCache, null, 2));
    }
    return out;
  }

  const milestones = [10000, 25000, 50000, 91000];
  const milestoneHit = Object.fromEntries(milestones.map(x => [x, null]));

  const stats = {
    totalQualifying: events.length,
    taken: 0,
    skippedRisk: 0,
    skippedConfidence: 0,
    hardStopped: false,

    skipReasons: { missingPnl: 0, dailyCap: 0, weeklyPause: 0, hardStop: 0, contractsSmall: 0 },


    wins: 0,
    losses: 0,

    peakCapital: capital,
    peakTrade: 0,
    maxDrawdownPct: 0,

    winStreak: 0,
    lossStreak: 0,
    bestWinStreak: 0,
    bestLossStreak: 0,

    dailyPnl: {},
    monthly: {},

    equityEvery10: [],
    pnls: [],
  };

  function updateDrawdown(tradeIndex) {
    if (capital > stats.peakCapital) {
      stats.peakCapital = capital;
      stats.peakTrade = tradeIndex;
    }
    const dd = (stats.peakCapital - capital) / stats.peakCapital;
    if (dd > stats.maxDrawdownPct) stats.maxDrawdownPct = dd;
  }

  for (const ev of events) {
    const gameDate = ev.game_date;

    // 1) Date rollover
    if (gameDate !== currentDate) {
      dailyDeployed = 0;
      currentDate = gameDate;

      // Weekly pause ends on Monday
      if (weekPaused && isMonday(gameDate)) {
        weekPaused = false;
        weekStartCapital = capital;
      }
    }

    // 2) Week rollover (reset weekStartCapital on Mondays)
    if (isMonday(gameDate)) {
      weekStartCapital = capital;
    }

    // 3) Risk gates
    const totalDrawdown = (startingCapital - capital) / startingCapital;
    if (totalDrawdown >= 0.25) {
      stats.hardStopped = true;
      stats.skipReasons.hardStop++;
      break;
    }

    const weeklyDrawdown = (weekStartCapital - capital) / weekStartCapital;
    if (weeklyDrawdown >= 0.15) {
      weekPaused = true;
      stats.skippedRisk++;
      stats.skipReasons.weeklyPause++;
      continue;
    }

    if ((dailyDeployed / capital) >= 0.10) {
      stats.skippedRisk++;
      stats.skipReasons.dailyCap++;
      continue;
    }

    // 4) Sizing with scorer
    const confidence = scoreFn({
      entry_prob: Number(ev.entry_prob),
      entry_quarter: Number(ev.entry_quarter),
      clock_remaining_sec: Number(ev.entry_clock_sec),
      score_deficit: Number(ev.score_deficit),
      momentum_3min: (ev.momentum_3min == null ? null : Number(ev.momentum_3min)),
    });

    if (confidence < 0.35) {
      stats.skippedConfidence++;
      continue;
    }

    let positionSize;
    if (sizingMode === 'tiered') {
      // Option B tiers (fixed dollars)
      if (confidence < 0.55) positionSize = 1000;
      else if (confidence <= 0.70) positionSize = 2000;
      else positionSize = 3000;
      positionSize = Math.min(positionSize, capital * 0.05);
    } else if (sizingMode === 'pct-tiered') {
      // Percent-of-current-capital tiers (compounding)
      const pct = (confidence < 0.55) ? 0.02 : (confidence <= 0.70) ? 0.04 : 0.06;
      positionSize = capital * pct;
      // safety cap: never exceed 5% of capital
      positionSize = Math.min(positionSize, capital * 0.05);
    } else if (sizingMode === 'kelly') {
      // Option C — Kelly fraction with hard cap
      // Use fixed p/b estimates from full season empirical averages.
      // (Could be made rolling; keep fixed for now.)
      const p = 0.603; // win rate
      const q = 1 - p;
      const b = 1.0126202913161058; // avgWin/|avgLoss|
      const kellyFull = p - (q / b);
      const kellyScaled = kellyFull * kellyFraction;
      const kellyCapped = Math.min(kellyScaled, kellyCap);
      positionSize = capital * Math.max(0, kellyCapped);
    } else {
      // Option A flat (current)
      const sizeMult = confidence < 0.55 ? 0.5 : 1.0;
      positionSize = Math.min(2000 * sizeMult, capital * 0.05);
    }

    const entryProb = Number(ev.entry_prob);
    const entryCents = entryProb * 100;
    // entry_prob is in dollars per contract (e.g. 0.47 = $0.47)
    const minContracts = args.minContracts ? Number(args.minContracts) : 1;
    const contracts = Math.floor(positionSize / entryProb);
    if (contracts < minContracts) {
      stats.skippedRisk++;
      stats.skipReasons.contractsSmall++;
      continue;
    }
    if (contracts <= 0) {
      stats.skippedRisk++;
      stats.skipReasons.contractsSmall++;
      continue;
    }

    // 5) P&L using PRODUCTION exit rules (per-contract cents)
    const prod = await prodPnlForEvent(ev);
    const pnlCentsPerContract = prod?.pnlC;
    if (!Number.isFinite(pnlCentsPerContract)) {
      stats.skippedRisk++;
      stats.skipReasons.missingPnl++;
      continue;
    }

    const pnlDollars = (pnlCentsPerContract / 100) * contracts;

    capital += pnlDollars;
    dailyDeployed += positionSize;

    stats.taken++;
    stats.pnls.push(pnlDollars);

    if (pnlDollars > 0) {
      stats.wins++;
      stats.winStreak++;
      stats.lossStreak = 0;
      stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.winStreak);
    } else {
      stats.losses++;
      stats.lossStreak++;
      stats.winStreak = 0;
      stats.bestLossStreak = Math.max(stats.bestLossStreak, stats.lossStreak);
    }

    // daily/monthly pnl
    stats.dailyPnl[gameDate] = (stats.dailyPnl[gameDate] || 0) + pnlDollars;
    const mKey = isoMonth(gameDate);
    const m = stats.monthly[mKey] || (stats.monthly[mKey] = { trades: 0, pnl: 0, capitalEnd: null });
    m.trades += 1;
    m.pnl += pnlDollars;
    m.capitalEnd = capital;

    updateDrawdown(stats.taken);

    // milestones
    for (const m of milestones) {
      if (milestoneHit[m] == null && capital >= m) milestoneHit[m] = stats.taken;
    }

    if (stats.taken % 10 === 0) {
      stats.equityEvery10.push({ trade: stats.taken, capital: capital });
    }

    fs.appendFileSync(outTrades, JSON.stringify({
      game_date: gameDate,
      game_id: ev.game_id,
      favorite_team: ev.favorite_team,
      entry_prob: entryProb,
      entry_quarter: ev.entry_quarter,
      entry_clock_sec: ev.entry_clock_sec,
      score_deficit: ev.score_deficit,
      momentum_3min: ev.momentum_3min,
      confidence,
      position_size: positionSize,
      contracts,
      pnl_cents_per_contract: pnlCentsPerContract,
      pnl_dollars: pnlDollars,
      capital_after: capital,

      exit_mode: exitMode,
      split_fired: !!prod?.split_fired,
      split_price: prod?.split_price ?? null,
      split_contracts_sold: prod?.split_fired ? Math.floor(contracts * splitPct) : 0,
      remainder_exit_reason: prod?.remainder_exit_reason ?? prod?.reason ?? null,
      remainder_exit_price: prod?.remainder_exit_price ?? prod?.exitC ?? null,
    }) + '\n');
  }

  // best/worst day
  let bestDay = null, worstDay = null;
  for (const [d, v] of Object.entries(stats.dailyPnl)) {
    if (bestDay == null || v > bestDay.pnl) bestDay = { date: d, pnl: v };
    if (worstDay == null || v < worstDay.pnl) worstDay = { date: d, pnl: v };
  }

  const totalReturnPct = ((capital - startingCapital) / startingCapital) * 100;
  const winRate = pct(stats.wins, stats.taken);
  const avgPerTrade = avg(stats.pnls);

  console.log(`BEANBOT BACKTEST — $${startingCapital.toFixed(0)} starting capital | sizing=${sizingMode}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total qualifying events: ${stats.totalQualifying}`);
  console.log(`Trades taken (after gates): ${stats.taken}`);
  console.log(`Trades skipped (risk gates): ${stats.skippedRisk}`);
  console.log(`Trades skipped (confidence): ${stats.skippedConfidence}`);
  console.log(`Final capital: $${capital.toFixed(0)}`);
  console.log(`Total return: ${totalReturnPct.toFixed(1)}%`);
  console.log(`Avg per trade: $${(avgPerTrade ?? 0).toFixed(2)}`);
  console.log(`Win rate: ${(winRate ?? 0).toFixed(1)}%`);
  console.log(`Max drawdown: -${(stats.maxDrawdownPct * 100).toFixed(1)}%`);
  console.log(`Longest win streak: ${stats.bestWinStreak}`);
  console.log(`Longest loss streak: ${stats.bestLossStreak}`);
  console.log(`Peak capital: $${stats.peakCapital.toFixed(0)} (after trade #${stats.peakTrade})`);
  if (worstDay) console.log(`Worst single day: $${worstDay.pnl.toFixed(0)} (${worstDay.date})`);
  if (bestDay) console.log(`Best single day: $${bestDay.pnl.toFixed(0)} (${bestDay.date})`);

  console.log('\nMONTHLY BREAKDOWN:');
  for (const k of Object.keys(stats.monthly).sort()) {
    const m = stats.monthly[k];
    console.log(`${k}: ${m.trades} trades | $${m.pnl.toFixed(0)} | Capital: $${(m.capitalEnd ?? 0).toFixed(0)}`);
  }

  console.log('\nEQUITY CURVE (every 10 trades):');
  for (const pt of stats.equityEvery10) {
    console.log(`Trade ${pt.trade}: $${pt.capital.toFixed(0)}`);
  }

  console.log(`\nExit mode: ${exitMode}${exitMode==='split-exit' ? ` (splitPct=${splitPct})` : ''}`);

  console.log('\nMILESTONES (trade #):');
  for (const m of milestones) {
    console.log(`- $${m.toLocaleString()}: ${milestoneHit[m] ?? 'N/A'}`);
  }

  console.log(`\nWrote trade log: ${outTrades}`);
  console.log('Skip reasons:', JSON.stringify(stats.skipReasons, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });

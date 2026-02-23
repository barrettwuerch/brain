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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const datasetFile = args.file || loadLatestDatasetFile(dir);

  const startingCapital = 50000;
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

  const stats = {
    totalQualifying: events.length,
    taken: 0,
    skippedRisk: 0,
    skippedConfidence: 0,
    hardStopped: false,

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
      break;
    }

    const weeklyDrawdown = (weekStartCapital - capital) / weekStartCapital;
    if (weeklyDrawdown >= 0.15) {
      weekPaused = true;
      stats.skippedRisk++;
      continue;
    }

    if ((dailyDeployed / capital) >= 0.10) {
      stats.skippedRisk++;
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

    const sizeMult = confidence < 0.55 ? 0.5 : 1.0;
    const positionSize = Math.min(2000 * sizeMult, capital * 0.05);

    const entryProb = Number(ev.entry_prob);
    const entryCents = entryProb * 100;
    const contracts = Math.floor(positionSize / entryCents);
    if (contracts <= 0) {
      stats.skippedRisk++;
      continue;
    }

    // 5) P&L using dataset implied_pnl_cents per contract
    const pnlCentsPerContract = Number(ev.implied_pnl_cents);
    if (!Number.isFinite(pnlCentsPerContract)) {
      stats.skippedRisk++;
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

  console.log('BEANBOT BACKTEST — $50,000 starting capital');
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

  console.log(`\nWrote trade log: ${outTrades}`);
}

main();

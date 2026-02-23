#!/usr/bin/env node
/**
 * sim_replay.mjs
 *
 * Replays historical games through the SAME engine code path as live trading.
 *
 * - Imports shouldEnter/shouldExit from src/engine.mjs
 * - Uses historical Kalshi 1-min candlesticks + ESPN summary wallclock timeline
 * - Runs fast (no artificial sleeps beyond minimal API pacing)
 *
 * Output:
 * - logs/sim_replay_YYYY-MM-DD.jsonl
 * - Prints: HISTORICAL DATASET vs SIM REPLAY
 */

import fs from 'node:fs';
import path from 'node:path';

import { KalshiClient } from '../src/kalshi_client.mjs';
import { JsonStateStore } from '../src/state_store.mjs';
import { jsonlLogger, parseArgs, safeMkdirp, sleep } from '../src/util.mjs';
import { parseNbaEventTicker } from '../src/nba_ticker_parse.mjs';
import { fetchEspnNbaScoreboard } from '../src/espn_scoreboard.mjs';
import { buildStateTimelineFromSummary, stateAtOrBefore } from '../src/espn_summary.mjs';
import { computeTopOfBook } from '../src/market_math.mjs';
import * as scorer from '../src/scorer.mjs';
import { shouldEnter, shouldExit, computeMidProbFromTob } from '../src/engine.mjs';
import { PaperBroker } from '../src/paper_broker.mjs';

function loadLatestDatasetFile(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('dataset_') && f.endsWith('.jsonl'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error(`No dataset_*.jsonl found in ${dir}`);
  return path.join(dir, files[0].f);
}

function parseCandles(resp) {
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

function tobFromMidProb(midProb) {
  const midC = Math.round(midProb * 100);
  const yesBid = Math.max(1, Math.min(99, midC - 1));
  const noBid = Math.max(1, Math.min(99, 100 - (midC + 1)));
  const tob = computeTopOfBook({ orderbook: { yes: [[yesBid, 1000]], no: [[noBid, 1000]] } });
  tob.midLockedC = midC;
  return tob;
}

function summarizeSimLog(file) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const skipCounts = {};
  const pnls = [];
  let entryChecks = 0;
  let entriesAllowed = 0;

  for (const ln of lines) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (o.type === 'entry_check') {
      entryChecks++;
      if (o.ok) entriesAllowed++;
      else {
        const r = o.skip_reason || 'unknown';
        skipCounts[r] = (skipCounts[r] || 0) + 1;
      }
    }
    if (o.type === 'paper_position_closed') {
      if (Number.isFinite(o.entryPriceC) && Number.isFinite(o.exitPriceC)) pnls.push(o.exitPriceC - o.entryPriceC);
    }
  }

  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const pos = pnls.filter(x => x > 0).length;

  return {
    entry_checks: entryChecks,
    entries_allowed: entriesAllowed,
    skip_reason_counts: skipCounts,
    trades_closed: pnls.length,
    pnl_avg_cents_per_contract: avg(pnls),
    pnl_pct_positive: pnls.length ? (pos / pnls.length) * 100 : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = args.dir || './data_full';
  const datasetFile = args.file || loadLatestDatasetFile(dataDir);

  const projRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cfgBase = JSON.parse(fs.readFileSync(path.join(projRoot, 'config.paper.json'), 'utf8'));
  const cfg = { ...cfgBase, replayMode: true };

  // Kalshi
  const keyId = fs.readFileSync(cfg.kalshi.keyIdPath, 'utf8').trim();
  const privateKeyPem = fs.readFileSync(cfg.kalshi.privateKeyPemPath, 'utf8');
  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });

  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  // Output logs
  const logsDir = path.join(projRoot, 'logs');
  safeMkdirp(logsDir);
  const day = new Date().toISOString().slice(0, 10);
  const simLog = path.join(logsDir, `sim_replay_${day}.jsonl`);
  if (fs.existsSync(simLog)) fs.unlinkSync(simLog);

  const log = jsonlLogger(logsDir);
  const _write = log.write;
  log.write = (obj) => {
    const row = { sim: true, ...obj };
    _write(row);
    fs.appendFileSync(simLog, JSON.stringify(row) + '\n');
  };

  const broker = new PaperBroker({ log });
  const state = new JsonStateStore({ dir: logsDir, filename: 'sim_state.json', log });

  // Load games list
  const rows = fs.readFileSync(datasetFile, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const games = rows.filter(r => r.type === 'no_event' || r.type === 'qualifying_event')
    .map(r => ({ gameId: r.game_id, date: r.game_date }))
    .filter(r => r.gameId && r.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.gameId < b.gameId ? -1 : 1)));

  // Build meta from ESPN scoreboards
  const sbCache = new Map();
  const toEspn = (a) => ({ GSW: 'GS', SAS: 'SA', NOP: 'NO', NYK: 'NY' }[a] || a);

  async function getScoreboard(isoDate) {
    if (sbCache.has(isoDate)) return sbCache.get(isoDate);
    const sb = await fetchEspnNbaScoreboard({ isoDate });
    sbCache.set(isoDate, sb);
    return sb;
  }

  const meta = [];
  for (const g of games) {
    const p = parseNbaEventTicker(g.gameId);
    if (!p?.ok) continue;
    const sb = await getScoreboard(p.date);
    const game = sb.games.find(x => x.awayAbbr === toEspn(p.away) && x.homeAbbr === toEspn(p.home));
    if (!game?.espnEventId || !game?.scheduledStartMs) continue;
    meta.push({ gameId: g.gameId, parsed: p, isoDate: p.date, eventId: game.espnEventId, scheduledStartMs: game.scheduledStartMs });
  }

  // Load ESPN summary timelines from cache
  const cacheDir = path.join(dataDir, 'cache');
  const tlByGame = new Map();
  for (const m of meta) {
    const pth = path.join(cacheDir, `espn_summary_${m.eventId}.json`);
    if (!fs.existsSync(pth)) continue;
    const sum = JSON.parse(fs.readFileSync(pth, 'utf8'));
    const tl = buildStateTimelineFromSummary(sum);
    tlByGame.set(m.gameId, tl);
  }

  // Group games by scheduled start to allow batching
  const groups = new Map();
  for (const m of meta) {
    if (!tlByGame.has(m.gameId)) continue;
    const k = `${m.isoDate}|${m.scheduledStartMs}`;
    const arr = groups.get(k) || [];
    arr.push(m);
    groups.set(k, arr);
  }

  const MAX_CANDLES_PER_CALL = 10000;
  const EST_CANDLES_PER_MARKET = 240;
  const MAX_MARKETS_PER_BATCH = Math.max(2, Math.floor(MAX_CANDLES_PER_CALL / EST_CANDLES_PER_MARKET) - 1);

  const stopC = Math.round(cfg.probability.exitStopProb * 100);
  const targetC = Math.round(cfg.probability.exitTargetProb * 100);

  let processed = 0;

  for (const [, arr] of groups.entries()) {
    const scheduledStartMs = arr[0].scheduledStartMs;
    const start_ts = String(Math.floor(scheduledStartMs / 1000));
    const end_ts = String(Math.floor((scheduledStartMs + 4 * 3600_000) / 1000));
    const period_interval = '1';

    const allTickers = [];
    for (const m of arr) {
      allTickers.push(`${m.gameId}-${m.parsed.away}`);
      allTickers.push(`${m.gameId}-${m.parsed.home}`);
    }

    for (let i = 0; i < allTickers.length; i += MAX_MARKETS_PER_BATCH) {
      const batchTickers = allTickers.slice(i, i + MAX_MARKETS_PER_BATCH);
      const resp = await client.getBatchCandlesticks({ market_tickers: batchTickers.join(','), start_ts, end_ts, period_interval });
      const mkts = resp?.markets || [];
      const byTicker = new Map(mkts.map(m => [m.market_ticker, m.candlesticks]));

      for (const m of arr) {
        const awayTicker = `${m.gameId}-${m.parsed.away}`;
        const homeTicker = `${m.gameId}-${m.parsed.home}`;
        if (!byTicker.has(awayTicker) || !byTicker.has(homeTicker)) continue;

        const awayCandles = byTicker.get(awayTicker) || [];
        const homeCandles = byTicker.get(homeTicker) || [];

        const tipTsSec = Math.floor(m.scheduledStartMs / 1000);
        const awayBase = awayCandles.find(c => Number(c.end_period_ts) >= tipTsSec);
        const homeBase = homeCandles.find(c => Number(c.end_period_ts) >= tipTsSec);
        const awayBaseP = awayBase ? candleMidProb(awayBase) : null;
        const homeBaseP = homeBase ? candleMidProb(homeBase) : null;
        if (awayBaseP == null || homeBaseP == null) continue;

        const favoriteTeam = (homeBaseP >= awayBaseP) ? m.parsed.home : m.parsed.away;
        const pregameLockedProb = Math.max(homeBaseP, awayBaseP);

        const st = state.ensureGame(m.gameId);
        st.parsed = m.parsed;
        st.favoriteTeam = favoriteTeam;
        st.pregameLockedProb = pregameLockedProb;
        st.scheduledStartMs = m.scheduledStartMs;
        state.save();

        const tl = tlByGame.get(m.gameId);
        const favTicker = `${m.gameId}-${favoriteTeam}`;
        const favCandles = (favoriteTeam === m.parsed.away) ? awayCandles : homeCandles;

        const hist = [];
        let lastCandle = null;

        for (const c of favCandles) {
          lastCandle = c;
          const tSec = Number(c.end_period_ts);
          const stEspn = stateAtOrBefore(tl, tSec);
          if (!stEspn) continue;

          const midProb = candleMidProb(c);
          if (midProb == null) continue;

          hist.push(midProb);
          while (hist.length > 4) hist.shift();
          const momentum_3min = (hist.length >= 4) ? (hist[hist.length - 1] - hist[0]) : null;

          const gs = {
            ok: true,
            provider: 'espn',
            updatedAtMs: Date.now(),
            quarter: Number(stEspn.period),
            clockSec: Number(stEspn.clockSec),
            homeScore: Number(stEspn.homeScore),
            awayScore: Number(stEspn.awayScore),
            state: 'in',
          };

          // Base tob from mid, then override midLockedC to threshold when candle indicates hit.
          let tob = tobFromMidProb(midProb);

          const hiC = Number.isFinite(c?.price?.high) ? Number(c.price.high) : null;
          const loC = Number.isFinite(c?.price?.low) ? Number(c.price.low) : null;
          const hitTarget = (hiC != null) && (hiC >= targetC);
          const hitStopRaw = (loC != null) && (loC < stopC);

          const favIsHome = (favoriteTeam === m.parsed.home);
          const favScore = favIsHome ? gs.homeScore : gs.awayScore;
          const oppScore = favIsHome ? gs.awayScore : gs.homeScore;
          const score_deficit = oppScore - favScore;
          const stopDisabled = Number.isFinite(score_deficit) && score_deficit <= 8;

          // Conservative intra-candle ordering.
          if (hitTarget && hitStopRaw && !stopDisabled) {
            tob = tobFromMidProb(stopC / 100);
            tob.midLockedC = stopC;
          } else if (hitTarget) {
            tob = tobFromMidProb(targetC / 100);
            tob.midLockedC = targetC;
          } else if (hitStopRaw && !stopDisabled) {
            tob = tobFromMidProb(stopC / 100);
            tob.midLockedC = stopC;
          }

          // Exit
          const pos = broker.getPosition(m.gameId);
          if (pos && pos.status === 'open') {
            const ex = shouldExit({ gameId: m.gameId, ticker: favTicker, tob, gs, cfg, position: pos, score_deficit });
            log.write({ t: tSec * 1000, type: 'exit_check', gameId: m.gameId, ticker: favTicker, score_deficit, ...ex });
            if (ex.ok) {
              let exitPriceC = tob.midLockedC;
              if (ex.reason === 'target_hit') exitPriceC = targetC;
              if (ex.reason === 'stop_loss') exitPriceC = stopC;
              broker.closePosition({ gameId: m.gameId, exitPriceC, reason: ex.reason });
              log.write({ t: tSec * 1000, type: 'exit', gameId: m.gameId, ticker: favTicker, ok: true, reason: ex.reason, midProb: computeMidProbFromTob(tob), exitPriceC });
            }
          }

          // Entry
          const ent = shouldEnter({
            gameId: m.gameId,
            ticker: favTicker,
            tob,
            depthNearMid: 1000,
            micro: { skip: false },
            stateGame: st,
            gs,
            cfg,
            alreadyTraded: broker.hasTradedGame(m.gameId),
            scorer,
            momentum_3min,
          });

          log.write({ t: tSec * 1000, type: 'entry_check', gameId: m.gameId, ticker: favTicker, ...ent });

          if (ent.ok) {
            const o = broker.placeLimit({ gameId: m.gameId, ticker: favTicker, side: 'YES', priceC: tob.midLockedC, qty: 1, goodForMs: 60_000 });
            // deterministic fill at our limit
            broker.pollFill(o.id, { tob: { ya: tob.midLockedC } });
          }
        }

        // Ensure close
        const posEnd = broker.getPosition(m.gameId);
        if (posEnd && posEnd.status === 'open' && lastCandle) {
          const closeC = Number.isFinite(lastCandle?.price?.close) ? Number(lastCandle.price.close) : null;
          const exitPriceC = Number.isFinite(closeC) ? closeC : Math.round((candleMidProb(lastCandle) ?? 0) * 100);
          broker.closePosition({ gameId: m.gameId, exitPriceC, reason: 'replay_end_of_data' });
          log.write({ t: Date.now(), type: 'exit', gameId: m.gameId, ticker: favTicker, ok: true, reason: 'replay_end_of_data', exitPriceC });
        }

        processed++;
        if (processed % 50 === 0) console.log(`processed games: ${processed}/${meta.length}`);
      }

      await sleep(10);
    }
  }

  const simSummary = summarizeSimLog(simLog);

  // Historical dataset headline
  const qrows = rows.filter(r => r.type === 'qualifying_event');
  const grows = rows.filter(r => r.type === 'no_event' || r.type === 'qualifying_event');
  const eligible = grows.filter(r => Number.isFinite(r.pregame_prob) && r.pregame_prob >= 0.65);
  const recovered = qrows.filter(r => r.recovered_60 === true).length;

  const hist = {
    games: grows.length,
    eligible: eligible.length,
    qualifying: qrows.length,
    qual_rate_conditional: eligible.length ? (qrows.length / eligible.length) : null,
    recovery_rate: qrows.length ? (recovered / qrows.length) : null,
  };

  console.log('SIM replay complete.');
  console.log(`Log: ${simLog}`);
  console.log('\n=== HISTORICAL DATASET vs SIM REPLAY ===');
  console.log('HIST:', hist);
  console.log('SIM :', simSummary);
}

main().catch(e => { console.error(e); process.exit(1); });

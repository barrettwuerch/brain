#!/usr/bin/env node
/**
 * pull_historical.mjs
 *
 * BeanBot / Intelligence Layer Phase 1
 *
 * Priority:
 * 1) Batch candlestick pull via /trade-api/v2/markets/candlesticks
 * 2) Detect first qualifying event per game (favorite dips 30–50% while losing, Q1–Q3)
 * 3) Compute derived fields: recovered_60, time_to_recover_sec, momentum_3min, implied_pnl
 * 4) (Optional) write to Supabase when env vars provided
 */

import fs from 'node:fs';
import path from 'node:path';

import { KalshiClient } from '../src/kalshi_client.mjs';
import { loadEnvFile, parseArgs, safeMkdirp, sleep } from '../src/util.mjs';
import { parseNbaEventTicker } from '../src/nba_ticker_parse.mjs';
import { fetchEspnNbaScoreboard } from '../src/espn_scoreboard.mjs';
import { fetchEspnNbaSummary, buildStateTimelineFromSummary, stateAtOrBefore } from '../src/espn_summary.mjs';

function mustRead(p) { return fs.readFileSync(p, 'utf8'); }
function loadCfg(cfgPath) {
  const abs = path.isAbsolute(cfgPath) ? cfgPath : path.resolve(process.cwd(), cfgPath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}
function isoToday() { return new Date().toISOString().slice(0, 10); }
function writeJsonl(file, obj) { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); }

function parseCandleResp(resp) {
  const cs = resp?.candlesticks || resp?.data?.candlesticks || resp?.data || [];
  return Array.isArray(cs) ? cs : [];
}

function teamFromMarketTicker(marketTicker) {
  return String(marketTicker).split('-').at(-1);
}

function candleMidProb(c) {
  // Prefer yes_bid/yes_ask close when available
  const yb = c?.yes_bid?.close;
  const ya = c?.yes_ask?.close;
  if (Number.isFinite(yb) && Number.isFinite(ya)) return (yb + ya) / 2 / 100;
  const mean = c?.price?.mean;
  if (Number.isFinite(mean)) return mean / 100;
  const close = c?.price?.close;
  if (Number.isFinite(close)) return close / 100;
  return null;
}

function findBaseline({ candlesByTeam, startTsSec }) {
  // First candle whose end_period_ts >= start
  const base = {};
  for (const [team, candles] of Object.entries(candlesByTeam)) {
    const c = candles.find(x => Number(x?.end_period_ts) >= startTsSec);
    if (!c) continue;
    const p = candleMidProb(c);
    if (p == null) continue;
    base[team] = { prob: p, ts: Number(c.end_period_ts) };
  }
  return base;
}

function computeImpliedPnlCents({ entryProb, timeline }) {
  // timeline: array of { tSec, prob } from entry minute inclusive onward
  // Exit rules for simulation: exit at first >=0.60; stop at first <0.25.
  const entryC = Math.round(entryProb * 100);
  for (const pt of timeline.slice(1)) {
    const c = Math.round(pt.prob * 100);
    if (c >= 60) return { exit: 60, reason: 'target', pnlCents: 60 - entryC };
    if (c < 25) return { exit: 25, reason: 'stop', pnlCents: 25 - entryC };
  }
  const maxC = Math.max(...timeline.map(pt => Math.round(pt.prob * 100)));
  return { exit: maxC, reason: 'max_after', pnlCents: maxC - entryC };
}

function minuteIndexFromSec(tSec, startTsSec) {
  return Math.floor((tSec - startTsSec) / 60);
}

function quarterClockFromMinute(minuteIdx) {
  // NBA: 12-min quarters. Approximate; ESPN scores are used for losing condition.
  const q = Math.floor(minuteIdx / 12) + 1;
  const inQMin = minuteIdx % 12;
  const clockSec = (12 * 60) - (inQMin * 60);
  return { quarter: q, clockSec };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const cfgPath = args.config || './config.paper.json';
  const cfg = loadCfg(cfgPath);

  const maxGames = args.maxGames ? Number(args.maxGames) : null;
  const maxMarkets = args.maxMarkets ? Number(args.maxMarkets) : null;
  const resumeIndex = args.resumeIndex ? Number(args.resumeIndex) : 0;

  const envFromFile = loadEnvFile(cfg.kalshi.envFile);
  const keyId = (cfg.kalshi.keyIdPath && fs.existsSync(cfg.kalshi.keyIdPath))
    ? mustRead(cfg.kalshi.keyIdPath).trim()
    : (envFromFile[cfg.kalshi.keyIdEnv] || process.env[cfg.kalshi.keyIdEnv]);
  const privateKeyPem = (cfg.kalshi.privateKeyPemPath && fs.existsSync(cfg.kalshi.privateKeyPemPath))
    ? mustRead(cfg.kalshi.privateKeyPemPath)
    : (envFromFile[cfg.kalshi.privateKeyEnv] || process.env[cfg.kalshi.privateKeyEnv]);

  if (!keyId || !privateKeyPem) throw new Error('Missing Kalshi credentials');

  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });
  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  const outDir = args.out || path.resolve(process.cwd(), 'data');
  safeMkdirp(outDir);

  const runId = `${isoToday()}_${Date.now()}`;
  const rawMarketsFile = path.join(outDir, `settled_markets_${runId}.json`);
  const datasetFile = path.join(outDir, `dataset_${runId}.jsonl`);
  const checkpointFile = path.join(outDir, `checkpoint_${runId}.json`);
  const cacheDir = path.join(outDir, 'cache');
  safeMkdirp(cacheDir);

  console.log('Pulling settled markets…');
  let markets = await (async () => {
    const out = [];
    let cursor = null;
    for (;;) {
      const q = { series_ticker: seriesTicker, status: 'settled', limit: '200' };
      if (cursor) q.cursor = cursor;
      const resp = await client.getMarkets(q);
      const ms = resp?.markets || resp?.data?.markets || [];
      out.push(...ms);
      const next = resp?.cursor || resp?.data?.cursor || resp?.next_cursor || null;
      if (!next || ms.length === 0) break;
      cursor = next;
    }
    return out;
  })();
  if (Number.isFinite(maxMarkets) && maxMarkets > 0) markets = markets.slice(0, maxMarkets);
  fs.writeFileSync(rawMarketsFile, JSON.stringify({ seriesTicker, count: markets.length, markets }, null, 2));
  console.log(`Markets: ${markets.length}`);

  // Group by game
  const byEvent = new Map();
  for (const m of markets) {
    const et = m.event_ticker;
    if (!et) continue;
    const arr = byEvent.get(et) || [];
    arr.push(m);
    byEvent.set(et, arr);
  }
  const eventTickers = Array.from(byEvent.keys()).sort();
  console.log(`Games: ${eventTickers.length}`);

  // cutoff for historical partition
  const cutoff = await client.getHistoricalCutoff();
  const boundaryIso = cutoff?.market_settled_ts || cutoff?.data?.market_settled_ts || null;
  const boundaryMs = boundaryIso ? Date.parse(boundaryIso) : null;

  // ESPN scoreboard cache
  const espnCache = new Map();

  // Build game metadata first (includes scheduled start and ESPN event id)
  const games = [];
  for (let idx = 0; idx < eventTickers.length; idx++) {
    if (idx < resumeIndex) continue;
    if (Number.isFinite(maxGames) && maxGames > 0 && games.length >= maxGames) break;

    const eventTicker = eventTickers[idx];
    const ms = byEvent.get(eventTicker) || [];
    const parsed = parseNbaEventTicker(eventTicker);
    if (!parsed.ok) {
      writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'bad_event_ticker' });
      continue;
    }

    // ESPN scoreboard by date
    let sb = espnCache.get(parsed.date);
    if (!sb) {
      try {
        sb = await fetchEspnNbaScoreboard({ isoDate: parsed.date });
        espnCache.set(parsed.date, sb);
      } catch (e) {
        writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'espn_fetch_failed', error: String(e?.message || e) });
        continue;
      }
    }

    // Find ESPN event
    const away = parsed.away;
    const home = parsed.home;
    // ESPN abbreviations can differ (GS/GSW, SA/SAS, NO/NOP)
    const toEspn = (a) => ({ GSW: 'GS', SAS: 'SA', NOP: 'NO', NYK: 'NY' }[a] || a);
    const awayE = toEspn(away);
    const homeE = toEspn(home);

    let espnGame = sb.games.find(g => g.awayAbbr === awayE && g.homeAbbr === homeE);
    if (!espnGame) {
      // date mismatch can happen around UTC midnight; try ±1 day scoreboards
      const d0 = new Date(parsed.date + 'T00:00:00Z');
      const tryDates = [
        new Date(d0.getTime() - 86400_000).toISOString().slice(0,10),
        new Date(d0.getTime() + 86400_000).toISOString().slice(0,10),
      ];
      for (const d of tryDates) {
        let sb2 = espnCache.get(d);
        if (!sb2) {
          try { sb2 = await fetchEspnNbaScoreboard({ isoDate: d }); espnCache.set(d, sb2); }
          catch { sb2 = null; }
        }
        if (sb2) {
          const g2 = sb2.games.find(g => g.awayAbbr === awayE && g.homeAbbr === homeE);
          if (g2) { espnGame = g2; break; }
        }
      }
    }

    if (!espnGame) {
      writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'espn_game_not_found', isoDate: parsed.date, away, home, awayE, homeE });
      continue;
    }

    // team markets
    const teamMarkets = new Map();
    for (const m of ms) teamMarkets.set(teamFromMarketTicker(m.ticker), m.ticker);
    if (!teamMarkets.has(away) || !teamMarkets.has(home)) {
      writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'missing_team_markets', teams: Array.from(teamMarkets.keys()) });
      continue;
    }

    const settledIso = ms[0]?.settlement_ts || ms[0]?.close_time || ms[0]?.updated_time || ms[0]?.expiration_time || null;
    const settledMs = settledIso ? Date.parse(settledIso) : null;
    const needsHistorical = (settledMs && boundaryMs) ? (settledMs < boundaryMs) : false;

    games.push({
      idx,
      eventTicker,
      parsed,
      isoDate: parsed.date,
      away,
      home,
      espnEventId: espnGame.espnEventId,
      scheduledStartMs: espnGame.scheduledStartMs,
      needsHistorical,
      marketTickers: [teamMarkets.get(away), teamMarkets.get(home)],
      marketByTeam: { [away]: teamMarkets.get(away), [home]: teamMarkets.get(home) },
    });

    if (games.length % 50 === 0) {
      fs.writeFileSync(checkpointFile, JSON.stringify({ runId, stage: 'meta', lastIdx: idx, games: games.length }, null, 2));
      console.log(`Meta ${games.length}/${maxGames || eventTickers.length}…`);
    }

    await sleep(25);
  }

  // Group for batch candlestick pulls: same isoDate + same scheduledStartMs + same needsHistorical
  const groups = new Map();
  for (const g of games) {
    const k = `${g.isoDate}|${g.scheduledStartMs}|${g.needsHistorical ? 'H' : 'C'}`;
    const arr = groups.get(k) || [];
    arr.push(g);
    groups.set(k, arr);
  }

  // Batch settings
  const MAX_CANDLES_PER_CALL = 10000;
  const PERIOD_INTERVAL_MIN = 1;
  const GAME_WINDOW_HOURS = 4;
  const EST_CANDLES_PER_MARKET = (GAME_WINDOW_HOURS * 60) / PERIOD_INTERVAL_MIN; // ~240
  const MAX_MARKETS_PER_BATCH = Math.max(2, Math.floor(MAX_CANDLES_PER_CALL / EST_CANDLES_PER_MARKET) - 1);

  console.log(`Batching: ~${MAX_MARKETS_PER_BATCH} markets/call (cap ${MAX_CANDLES_PER_CALL} candles)`);

  let processedGames = 0;

  for (const [k, arr] of groups.entries()) {
    // Split into market batches
    const isoDate = arr[0].isoDate;
    const scheduledStartMs = arr[0].scheduledStartMs;
    const needsHistorical = arr[0].needsHistorical;

    // Fetch ESPN summaries for games in this group (cache per espnEventId)
    const stateTimelineByGame = new Map();
    for (const g of arr) {
      const cachePath = path.join(cacheDir, `espn_summary_${g.espnEventId}.json`);
      let summary;
      try {
        if (fs.existsSync(cachePath)) {
          summary = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        } else {
          summary = await fetchEspnNbaSummary({ eventId: g.espnEventId });
          fs.writeFileSync(cachePath, JSON.stringify(summary));
          await sleep(100);
        }
        stateTimelineByGame.set(g.eventTicker, buildStateTimelineFromSummary(summary));
      } catch (e) {
        writeJsonl(datasetFile, { type: 'skip_game', eventTicker: g.eventTicker, reason: 'espn_summary_failed', error: String(e?.message || e) });
      }
    }

    // Candlestick window
    const start_ts = String(Math.floor(scheduledStartMs / 1000));
    const end_ts = String(Math.floor((scheduledStartMs + GAME_WINDOW_HOURS * 60 * 60 * 1000) / 1000));
    const period_interval = String(PERIOD_INTERVAL_MIN);

    // Flatten market tickers
    const allMarketTickers = arr.flatMap(g => g.marketTickers);

    for (let i = 0; i < allMarketTickers.length; i += MAX_MARKETS_PER_BATCH) {
      const batchTickers = allMarketTickers.slice(i, i + MAX_MARKETS_PER_BATCH);

      let batchResp;
      try {
        if (needsHistorical) {
          // No documented batch for historical tier; fall back to per-market historical.
          batchResp = {};
          for (const t of batchTickers) {
            const r = await client.getHistoricalCandlesticks(t, { start_ts, end_ts, period_interval });
            batchResp[t] = parseCandleResp(r);
            await sleep(40);
          }
        } else {
          batchResp = await client.getBatchCandlesticks({
            market_tickers: batchTickers.join(','),
            start_ts,
            end_ts,
            period_interval,
          });
        }
      } catch (e) {
        writeJsonl(datasetFile, { type: 'batch_error', isoDate, scheduledStartMs, needsHistorical, error: String(e?.message || e), status: e?.status || null });
        await sleep(300);
        continue;
      }

      // Normalize batch response into map ticker->candles
      const candlesByTicker = new Map();
      if (needsHistorical) {
        for (const [t, cs] of Object.entries(batchResp)) candlesByTicker.set(t, cs);
      } else {
        // Actual shape: { markets: [ { market_ticker, candlesticks:[...] }, ... ] }
        const items = batchResp?.markets || batchResp?.data?.markets || [];
        if (Array.isArray(items)) {
          for (const it of items) {
            const t = it.market_ticker || it.ticker;
            const cs = it.candlesticks || it.data?.candlesticks || it.data || [];
            if (t) candlesByTicker.set(t, Array.isArray(cs) ? cs : []);
          }
        }
      }

      // Process games that have both team tickers present in this batch slice
      const batchTickerSet = new Set(batchTickers);
      for (const g of arr) {
        if (!batchTickerSet.has(g.marketByTeam[g.away]) && !batchTickerSet.has(g.marketByTeam[g.home])) continue;

        const awayTicker = g.marketByTeam[g.away];
        const homeTicker = g.marketByTeam[g.home];
        const awayCandles = candlesByTicker.get(awayTicker) || [];
        const homeCandles = candlesByTicker.get(homeTicker) || [];

        if (!awayCandles.length || !homeCandles.length) {
          // We may have split across batches; allow later batch to fill.
          // Only emit a row once both are available.
          continue;
        }

        const startTsSec = Math.floor(g.scheduledStartMs / 1000);
        const baseline = findBaseline({ candlesByTeam: { [g.away]: awayCandles, [g.home]: homeCandles }, startTsSec });
        if (!baseline[g.away] || !baseline[g.home]) {
          writeJsonl(datasetFile, { type: 'skip_game', eventTicker: g.eventTicker, reason: 'no_baseline', isoDate: g.isoDate });
          continue;
        }

        const favoriteTeam = (baseline[g.home].prob >= baseline[g.away].prob) ? g.home : g.away;
        const pregameProb = Math.max(baseline[g.home].prob, baseline[g.away].prob);

        // Build favorite timeline as per-minute points
        const favTicker = g.marketByTeam[favoriteTeam];
        const favCandles = (favoriteTeam === g.away) ? awayCandles : homeCandles;

        const timeline = favCandles
          .map(c => ({ tSec: Number(c.end_period_ts), prob: candleMidProb(c) }))
          .filter(x => Number.isFinite(x.tSec) && x.prob != null)
          .filter(x => x.tSec >= startTsSec);

        const stateTimeline = stateTimelineByGame.get(g.eventTicker) || [];

        // Walk REAL-TIME candlesticks and map each candle to ESPN state via wallclock timestamps.
        let qualifying = null;
        for (let idxPt = 0; idxPt < timeline.length; idxPt++) {
          const pt = timeline[idxPt];
          const prob = pt.prob;
          if (prob < 0.30 || prob > 0.50) continue;

          const st = stateAtOrBefore(stateTimeline, pt.tSec);
          if (!st) continue;
          const quarter = st.period;
          const clockSec = st.clockSec;
          if (quarter < 1 || quarter > 3) continue;

          const favIsHome = (favoriteTeam === g.home);
          const favScore = favIsHome ? st.homeScore : st.awayScore;
          const oppScore = favIsHome ? st.awayScore : st.homeScore;
          if (!(favScore < oppScore)) continue;

          // momentum over prior 3 candles (3 real minutes)
          const prev = timeline[Math.max(0, idxPt - 3)];
          const momentum3 = (idxPt >= 3 && prev?.prob != null) ? (prob - prev.prob) : null;

          // recovered_60, time_to_recover (GAME CLOCK seconds)
          // We compute delta in game-clock time using ESPN state at entry and at recovery.
          const gameElapsed = (st) => (Number.isFinite(st?.period) && Number.isFinite(st?.clockSec))
            ? ((st.period - 1) * 12 * 60 + (12 * 60 - st.clockSec))
            : null;

          let recovered60 = false;
          let timeToRecoverSec = null;
          const entryElapsed = gameElapsed(st);

          for (let j = idxPt + 1; j < timeline.length; j++) {
            if (timeline[j].prob >= 0.60) {
              const st2 = stateAtOrBefore(stateTimeline, timeline[j].tSec);
              const recElapsed = gameElapsed(st2);
              if (entryElapsed != null && recElapsed != null && recElapsed >= entryElapsed) {
                recovered60 = true;
                timeToRecoverSec = (recElapsed - entryElapsed);
              } else {
                recovered60 = true;
                timeToRecoverSec = null;
              }
              break;
            }
          }

          const pnlSim = computeImpliedPnlCents({ entryProb: prob, timeline: timeline.slice(idxPt) });

          qualifying = {
            game_id: g.eventTicker,
            game_date: g.isoDate,
            pregame_prob: pregameProb,
            favorite_team: favoriteTeam,
            entry_prob: prob,
            entry_quarter: quarter,
            entry_clock_sec: clockSec,
            score_deficit: oppScore - favScore,
            momentum_3min: momentum3,
            peak_prob_after: Math.max(...timeline.slice(idxPt).map(x => x.prob)),
            recovered_60: recovered60,
            time_to_recover_sec: timeToRecoverSec,
            implied_pnl_cents: pnlSim.pnlCents,
            exit_reason: pnlSim.reason,
            entry_ts: pt.tSec,
          };
          break;
        }

        // Enforce pregame >= 0.65 for dataset rows (matches strategy)
        if (pregameProb < 0.65) {
          writeJsonl(datasetFile, { type: 'no_event', game_id: g.eventTicker, game_date: g.isoDate, pregame_prob: pregameProb, favorite_team: favoriteTeam, note: 'pregame_below_threshold' });
        } else if (qualifying) {
          writeJsonl(datasetFile, { type: 'qualifying_event', ...qualifying });
        } else {
          writeJsonl(datasetFile, { type: 'no_event', game_id: g.eventTicker, game_date: g.isoDate, pregame_prob: pregameProb, favorite_team: favoriteTeam });
        }

        processedGames++;
        if (processedGames % 25 === 0) {
          fs.writeFileSync(checkpointFile, JSON.stringify({ runId, stage: 'events', processedGames, lastGroup: k, batchIndex: i }, null, 2));
          console.log(`Processed games: ${processedGames}/${games.length}`);
        }
      }

      // rate limiting between batches
      await sleep(200);
    }
  }

  console.log('Done.');
  console.log('Raw markets:', rawMarketsFile);
  console.log('Dataset JSONL:', datasetFile);
  console.log('Checkpoint:', checkpointFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

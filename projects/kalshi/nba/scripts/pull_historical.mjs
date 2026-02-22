#!/usr/bin/env node
/**
 * pull_historical.mjs
 *
 * Goal (per BeanBot_Intelligence_Build_Plan):
 * - Pull all SETTLED KXNBAGAME markets
 * - For each market: 1-minute candlesticks covering the game
 * - ESPN cross-reference (quarter/clock/score)
 * - Emit a structured dataset (JSONL) suitable for Supabase ingest
 *
 * Notes:
 * - This script is intentionally conservative: it persists raw pulls and resumes.
 * - It does not require the live trading engine.
 */

import fs from 'node:fs';
import path from 'node:path';

import { KalshiClient } from '../src/kalshi_client.mjs';
import { loadEnvFile, parseArgs, safeMkdirp, sleep } from '../src/util.mjs';
import { parseNbaEventTicker } from '../src/nba_ticker_parse.mjs';
import { fetchEspnNbaScoreboard } from '../src/espn_scoreboard.mjs';

function mustRead(p) {
  return fs.readFileSync(p, 'utf8');
}

function loadCfg(cfgPath) {
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function writeJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function centsToProb(c) {
  return Number.isFinite(c) ? c / 100 : null;
}

function pickTeamFromMarketTicker(marketTicker) {
  return String(marketTicker).split('-').at(-1);
}

function parseCandleResp(resp) {
  // Kalshi candlestick response schema can vary; normalize.
  const cs = resp?.candlesticks || resp?.data?.candlesticks || resp?.candles || resp?.data || [];
  return Array.isArray(cs) ? cs : [];
}

async function fetchAllSettledMarkets({ client, seriesTicker, pageLimit = 200 }) {
  // Uses pagination via cursor if present.
  const out = [];
  let cursor = null;
  for (;;) {
    const q = { series_ticker: seriesTicker, status: 'settled', limit: String(pageLimit) };
    if (cursor) q.cursor = cursor;
    const resp = await client.getMarkets(q);
    const markets = resp?.markets || resp?.data?.markets || [];
    out.push(...markets);
    const next = resp?.cursor || resp?.data?.cursor || resp?.next_cursor || null;
    if (!next || markets.length === 0) break;
    cursor = next;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const maxGames = args.maxGames ? Number(args.maxGames) : null;
  const maxMarkets = args.maxMarkets ? Number(args.maxMarkets) : null;

  const cfgPath = args.config || path.resolve(process.cwd(), '../config.paper.json');
  const cfg = loadCfg(cfgPath);

  // Secrets (file-based preferred)
  const envFromFile = loadEnvFile(cfg.kalshi.envFile);
  const keyId = (cfg.kalshi.keyIdPath && fs.existsSync(cfg.kalshi.keyIdPath))
    ? mustRead(cfg.kalshi.keyIdPath).trim()
    : (envFromFile[cfg.kalshi.keyIdEnv] || process.env[cfg.kalshi.keyIdEnv]);
  const privateKeyPem = (cfg.kalshi.privateKeyPemPath && fs.existsSync(cfg.kalshi.privateKeyPemPath))
    ? mustRead(cfg.kalshi.privateKeyPemPath)
    : (envFromFile[cfg.kalshi.privateKeyEnv] || process.env[cfg.kalshi.privateKeyEnv]);

  if (!keyId || !privateKeyPem) throw new Error('Missing Kalshi credentials');

  const baseUrl = args.baseUrl || cfg.kalshi.baseUrl;
  const client = new KalshiClient({ baseUrl, keyId, privateKeyPem });
  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  const outDir = args.out || path.resolve(process.cwd(), 'data');
  safeMkdirp(outDir);

  const runId = `${todayIso()}_${Date.now()}`;
  const rawMarketsFile = path.join(outDir, `settled_markets_${runId}.json`);
  const datasetFile = path.join(outDir, `dataset_${runId}.jsonl`);

  console.log('Pulling settled markets…');
  let markets = await fetchAllSettledMarkets({ client, seriesTicker });
  if (Number.isFinite(maxMarkets) && maxMarkets > 0) markets = markets.slice(0, maxMarkets);
  fs.writeFileSync(rawMarketsFile, JSON.stringify({ seriesTicker, count: markets.length, markets }, null, 2));
  console.log(`Markets: ${markets.length}`);

  // Group markets by event_ticker (game id)
  const byEvent = new Map();
  for (const m of markets) {
    const et = m.event_ticker;
    if (!et) continue;
    const arr = byEvent.get(et) || [];
    arr.push(m);
    byEvent.set(et, arr);
  }

  console.log(`Games: ${byEvent.size}`);

  // ESPN cache per date
  const espnCache = new Map();

  // historical cutoff cache
  let cutoff = null;

  let n = 0;
  for (const [eventTicker, ms] of byEvent.entries()) {
    n++;
    if (Number.isFinite(maxGames) && maxGames > 0 && n > maxGames) break;
    const parsed = parseNbaEventTicker(eventTicker);
    if (!parsed.ok) {
      writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'bad_event_ticker' });
      continue;
    }

    // ESPN scoreboard for game date
    const isoDate = parsed.date;
    let sb = espnCache.get(isoDate);
    if (!sb) {
      try {
        sb = await fetchEspnNbaScoreboard({ isoDate });
        espnCache.set(isoDate, sb);
      } catch (e) {
        writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'espn_fetch_failed', error: String(e?.message || e) });
        continue;
      }
    }

    // Locate ESPN game
    // ESPN uses some 2-letter codes; scoreboard module already surfaces normalized abbreviations,
    // but we still match on exact values present there.
    const away = parsed.away;
    const home = parsed.home;
    const espnGame = sb.games.find(g => g.awayAbbr === away && g.homeAbbr === home)
      || sb.games.find(g => (g.awayAbbr === (away === 'GSW' ? 'GS' : away)) && (g.homeAbbr === (home === 'GSW' ? 'GS' : home)));

    if (!espnGame) {
      writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'espn_game_not_found', isoDate, away, home });
      continue;
    }

    const scheduledStartMs = espnGame.scheduledStartMs;

    // Pull candlesticks for BOTH team markets (market tickers end with -TEAM)
    const teamMarkets = new Map();
    for (const m of ms) {
      const team = pickTeamFromMarketTicker(m.ticker);
      teamMarkets.set(team, m.ticker);
    }

    if (!teamMarkets.has(away) || !teamMarkets.has(home)) {
      writeJsonl(datasetFile, { type: 'skip_game', eventTicker, reason: 'missing_team_markets', teams: Array.from(teamMarkets.keys()) });
      continue;
    }

    // Determine whether to use /historical tier (partitioned data)
    // We fetch cutoff once per run.
    if (cutoff == null) {
      try {
        cutoff = await client.getHistoricalCutoff();
      } catch (e) {
        writeJsonl(datasetFile, { type: 'warning', msg: 'historical_cutoff_failed', error: String(e?.message || e) });
        cutoff = {};
      }
    }

    // Determine whether to use /historical tier (partitioned data)
    if (cutoff == null) {
      try {
        cutoff = await client.getHistoricalCutoff();
      } catch (e) {
        writeJsonl(datasetFile, { type: 'warning', msg: 'historical_cutoff_failed', error: String(e?.message || e) });
        cutoff = {};
      }
    }

    const settledIso = ms[0]?.settlement_ts || ms[0]?.close_time || ms[0]?.updated_time || ms[0]?.expiration_time || null;
    const settledMs = settledIso ? Date.parse(settledIso) : null;
    const boundaryIso = cutoff?.market_settled_ts || cutoff?.data?.market_settled_ts || null; // ISO string
    const boundaryMs = boundaryIso ? Date.parse(boundaryIso) : null;
    const needsHistorical = (settledMs && boundaryMs) ? (settledMs < boundaryMs) : false;

    // Candlestick query params (required): start_ts, end_ts, period_interval (minutes)
    const start_ts = String(Math.floor(scheduledStartMs / 1000));
    const end_ts = String(Math.floor((scheduledStartMs + 4 * 60 * 60 * 1000) / 1000)); // 4h window
    const period_interval = '1';

    const candlesByTeam = {};
    for (const team of [away, home]) {
      const mt = teamMarkets.get(team);
      let resp;
      try {
        if (needsHistorical) {
          resp = await client.getHistoricalCandlesticks(mt, { start_ts, end_ts, period_interval });
        } else {
          resp = await client.getSeriesMarketCandlesticks(seriesTicker, mt, { start_ts, end_ts, period_interval });
        }
      } catch (e) {
        writeJsonl(datasetFile, { type: 'skip_market', eventTicker, marketTicker: mt, team, reason: 'candles_fetch_failed', needsHistorical, error: String(e?.message || e), status: e?.status || null });
        continue;
      }
      candlesByTeam[team] = parseCandleResp(resp);
      await sleep(80);
    }

    // TODO: Normalize candles to 1-minute timestamps from scheduledStartMs to end.
    // TODO: Compute pregame baseline: first minute at/after scheduledStartMs across both markets; favorite = max prob.
    // TODO: Identify qualifying dips (favorite prob enters 30–50% in Q1–Q3 while favorite losing) via ESPN play-by-play or score timeline.

    writeJsonl(datasetFile, {
      type: 'game_raw',
      eventTicker,
      isoDate,
      away,
      home,
      scheduledStartMs,
      markets: { away: teamMarkets.get(away), home: teamMarkets.get(home) },
      candlesMeta: {
        awayCount: candlesByTeam[away]?.length || 0,
        homeCount: candlesByTeam[home]?.length || 0,
      },
    });

    if (n % 25 === 0) console.log(`Processed ${n}/${byEvent.size}`);
  }

  console.log('Done.');
  console.log('Raw markets:', rawMarketsFile);
  console.log('Dataset JSONL:', datasetFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

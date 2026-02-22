#!/usr/bin/env node
/**
 * hist_audit.mjs
 *
 * Automated audit pass (Layers 1–5) over the completed historical dataset.
 *
 * Outputs:
 * - anomalies summary
 * - 10-game audit pack (files) for manual Kalshi website verification
 *
 * Usage:
 *   npm run hist:audit -- --dir ./data_full --sample 10
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, sleep, safeMkdirp } from '../src/util.mjs';
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

function pickBaselineProbFromCandles(candles, tipTsSec) {
  const c = candles.find(x => Number(x?.end_period_ts) >= tipTsSec);
  if (!c) return null;
  const p = candleMidProb(c);
  return p;
}

function sampleArray(arr, n, seed = 1) {
  // deterministic pseudo-random sample
  let x = seed >>> 0;
  function rand() {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 2**32;
  }
  const a = [...arr];
  const out = [];
  while (a.length && out.length < n) {
    const i = Math.floor(rand() * a.length);
    out.push(a.splice(i, 1)[0]);
  }
  return out;
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return (s.length % 2) ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(a) {
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function toEspnAbbr(a) {
  return ({ GSW: 'GS', SAS: 'SA', NOP: 'NO', NYK: 'NY' }[a] || a);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || './data_full';
  const file = args.file || loadLatestDatasetFile(dir);
  const sampleN = args.sample ? Number(args.sample) : 10;

  const outDir = path.join(dir, 'audit');
  safeMkdirp(outDir);

  const projRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cfg = JSON.parse(fs.readFileSync(path.join(projRoot, 'config.paper.json'), 'utf8'));
  const keyId = fs.readFileSync(cfg.kalshi.keyIdPath, 'utf8').trim();
  const privateKeyPem = fs.readFileSync(cfg.kalshi.privateKeyPemPath, 'utf8');
  const client = new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem });
  const seriesTicker = cfg.nba?.seriesTicker || 'KXNBAGAME';

  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const games = rows.filter(r => r.type === 'no_event' || r.type === 'qualifying_event');
  const qual = rows.filter(r => r.type === 'qualifying_event');

  // --- Layer 5 statistical sanity (quick) ---
  const ttr = qual.map(r => r.time_to_recover_sec).filter(x => Number.isFinite(x));
  const q3 = qual.filter(r => r.entry_quarter === 3);

  // --- Layer 6 quick stats (partial, automated) ---
  const noStop = qual.filter(r => Number(r.score_deficit) <= 8);

  // --- Layer 1–2 audit pack: select 10 games (prefer mix of qualifying and no_event) ---
  const mix = sampleArray(qual.map(r => r.game_id), Math.ceil(sampleN / 2), 42)
    .concat(sampleArray(games.map(r => r.game_id).filter(id => !qual.some(q => q.game_id === id)), Math.floor(sampleN / 2), 99));
  const picked = [...new Set(mix)].slice(0, sampleN);

  const sbCache = new Map();

  const anomalies = {
    espn_miss: 0,
    baseline_mismatch: 0,
    bad_state_mapping: 0,
  };

  const mappingFailGames = [];

  for (const gameId of picked) {
    const p = parseNbaEventTicker(gameId);
    if (!p?.ok) continue;

    // ESPN scoreboard
    let sb = sbCache.get(p.date);
    if (!sb) {
      try {
        sb = await fetchEspnNbaScoreboard({ isoDate: p.date });
        sbCache.set(p.date, sb);
      } catch {
        anomalies.espn_miss++;
        continue;
      }
    }

    const g = sb.games.find(x => x.awayAbbr === toEspnAbbr(p.away) && x.homeAbbr === toEspnAbbr(p.home));
    const eventId = g?.espnEventId || null;
    if (!eventId) {
      anomalies.espn_miss++;
      continue;
    }

    // ESPN summary timeline
    const summary = await fetchEspnNbaSummary({ eventId });
    const tl = buildStateTimelineFromSummary(summary);

    const tipTsSec = Math.floor((g.scheduledStartMs || Date.parse(g.scheduledStartIso)) / 1000);

    // Pull candlesticks for both team markets (short window around tip)
    const start_ts = String(tipTsSec - 1800);
    const end_ts = String(tipTsSec + 7200);

    const awayTicker = `${gameId}-${p.away}`;
    const homeTicker = `${gameId}-${p.home}`;

    const awayResp = await client.getSeriesMarketCandlesticks(seriesTicker, awayTicker, { start_ts, end_ts, period_interval: '1' });
    const homeResp = await client.getSeriesMarketCandlesticks(seriesTicker, homeTicker, { start_ts, end_ts, period_interval: '1' });

    const awayCandles = parseCandleResp(awayResp);
    const homeCandles = parseCandleResp(homeResp);

    const awayBase = pickBaselineProbFromCandles(awayCandles, tipTsSec);
    const homeBase = pickBaselineProbFromCandles(homeCandles, tipTsSec);

    // Mapping check: sample candles around tip-off (to avoid pregame periods where ESPN has no plays yet)
    function aroundTip(candles) {
      // find first index at/after tip
      let j = candles.findIndex(x => Number(x?.end_period_ts) >= tipTsSec);
      if (j < 0) j = 0;
      const lo = Math.max(0, j - 5);
      const hi = Math.min(candles.length, j + 5);
      return candles.slice(lo, hi);
    }

    // We expect ESPN plays to start after the first real event (tip may have no play logged).
    // So we validate mapping by checking that within the first 20 minutes after tip we can map
    // at least a few candles to a valid ESPN state.
    const windowStart = tipTsSec;
    const windowEnd = tipTsSec + 20 * 60;
    const sampleCandles = awayCandles.concat(homeCandles)
      .filter(x => Number(x?.end_period_ts) >= windowStart && Number(x?.end_period_ts) <= windowEnd)
      .slice(0, 30);

    let mappingOk = 0;
    for (const c of sampleCandles) {
      const tSec = Number(c.end_period_ts);
      const st = stateAtOrBefore(tl, tSec);
      if (st && st.period >= 1 && st.period <= 4 && st.clockSec >= 0 && st.clockSec <= 12 * 60) mappingOk++;
    }

    if (mappingOk < 5) {
      anomalies.bad_state_mapping++;
      mappingFailGames.push({ gameId, mappingOk, sampleCandles: sampleCandles.map(x => x.end_period_ts).slice(0, 5) });
    }

    const pack = {
      gameId,
      parsed: p,
      espn: {
        isoDate: p.date,
        espnEventId: eventId,
        scheduledStartIso: g.scheduledStartIso,
        scheduledStartMs: g.scheduledStartMs,
        tipTsSec,
      },
      kalshi: {
        awayTicker,
        homeTicker,
        baselineAtOrAfterTip: {
          away: awayBase,
          home: homeBase,
        },
        notesForManualCheck: {
          verifyKalshiChartMatchesCandles: true,
          verifyBaselineMatchesOpeningAroundTip: true,
        },
      },
      samples: {
        awayCandles_first5: awayCandles.slice(0, 5),
        homeCandles_first5: homeCandles.slice(0, 5),
        espnTimeline_first5: tl.slice(0, 5),
      },
    };

    fs.writeFileSync(path.join(outDir, `game_${gameId}.json`), JSON.stringify(pack, null, 2));
    await sleep(50);
  }

  // --- Layer 4 intra-candle ordering ambiguity (flag only) ---
  // NOTE: We cannot resolve ordering with 1-min bars. We count ambiguous candles where
  // high>=target and low<stop in the same candle.
  const targetC = 68;
  const stopC = 25;
  let ambiguous = 0;
  let checked = 0;

  for (const ev of qual.slice(0, 50)) {
    // sample 50 qualifying events for ambiguity scan
    const gameId = ev.game_id;
    const team = ev.favorite_team;
    const marketTicker = `${gameId}-${team}`;
    const entryTs = Number(ev.entry_ts);

    const resp = await client.getSeriesMarketCandlesticks(seriesTicker, marketTicker, {
      start_ts: String(entryTs),
      end_ts: String(entryTs + 4 * 3600),
      period_interval: '1',
    });
    const cs = parseCandleResp(resp);

    for (const c of cs) {
      const hi = Number(c?.price?.high);
      const lo = Number(c?.price?.low);
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
      checked++;
      if (hi >= targetC && lo < stopC) ambiguous++;
    }
    await sleep(40);
  }

  const summary = {
    dataset: file,
    sample_games_written: picked.length,
    audit_pack_dir: outDir,
    mapping_fail_games: mappingFailGames,

    layer5_sanity: {
      qualifying_events: qual.length,
      ttr_median_sec: median(ttr),
      ttr_avg_sec: avg(ttr),
      q3_events: q3.length,
    },

    layer6_ruleB_stats: {
      deficit_le_8_events: noStop.length,
      deficit_le_8_recovered_60_rate: noStop.length ? (noStop.filter(r => r.recovered_60).length / noStop.length) : null,
    },

    layer4_intra_candle_ambiguity: {
      candles_checked: checked,
      ambiguous_candles_high_target_low_stop_same_bar: ambiguous,
      note: 'If this is high, you need higher-resolution data or a conservative ordering assumption.'
    },

    anomalies,
  };

  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));

  console.log('=== hist:audit complete ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nAudit pack written to: ${outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });

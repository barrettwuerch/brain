#!/usr/bin/env node
/**
 * nba_bot.mjs (v0)
 *
 * Paper/shadow bot scaffold for NBA live probability mean-reversion.
 *
 * NOTE: ESPN integration is not implemented yet; this currently logs market snapshots
 * and validates microstructure constraints (spread/depth) where possible.
 */

import fs from 'node:fs';
import path from 'node:path';

import { KalshiClient } from './kalshi_client.mjs';
import { computeTopOfBook, depthNearMid } from './market_math.mjs';
import { PaperBroker } from './paper_broker.mjs';
import { fetchGameStateEspn } from './game_state_espn.mjs';
import { fetchGameStateFromKalshi } from './game_state_kalshi.mjs';
import { discoverNbaMarkets } from './discovery.mjs';
import { JsonStateStore } from './state_store.mjs';
import { jsonlLogger, loadEnvFile, nowMs, parseArgs, sleep } from './util.mjs';
import { shouldEnter, shouldExit, computeMidProbFromTob } from './engine.mjs';

function loadConfig(p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function requireCfg(cfg, keyPath) {
  const parts = keyPath.split('.');
  let cur = cfg;
  for (const k of parts) {
    cur = cur?.[k];
  }
  if (cur === undefined || cur === null || cur === '') {
    throw new Error(`Missing config: ${keyPath}`);
  }
  return cur;
}

function midProbFromLockedCents(midLockedC) {
  if (!Number.isFinite(midLockedC)) return null;
  return midLockedC / 100;
}

function shouldSkipByMicrostructure({ tob, cfg }) {
  if (!tob) return { skip: true, reason: 'no_tob' };
  if (!Number.isFinite(tob.spreadC)) return { skip: true, reason: 'no_spread' };
  if (tob.spreadC > cfg.execution.maxSpreadCents) return { skip: true, reason: `spread_${tob.spreadC}` };
  return { skip: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfgPath = args.config || args.c;
  if (!cfgPath) {
    console.error('Usage: node src/nba_bot.mjs --config <config.json>');
    process.exit(2);
  }

  const cfg = loadConfig(cfgPath);

  const envFromFile = loadEnvFile(cfg.kalshi.envFile);

  // Prefer file-based secrets (safer than multiline env vars)
  const keyId = (cfg.kalshi.keyIdPath && fs.existsSync(cfg.kalshi.keyIdPath))
    ? fs.readFileSync(cfg.kalshi.keyIdPath, 'utf8').trim()
    : (envFromFile[cfg.kalshi.keyIdEnv] || process.env[cfg.kalshi.keyIdEnv]);

  const privateKeyPem = (cfg.kalshi.privateKeyPemPath && fs.existsSync(cfg.kalshi.privateKeyPemPath))
    ? fs.readFileSync(cfg.kalshi.privateKeyPemPath, 'utf8')
    : (envFromFile[cfg.kalshi.privateKeyEnv] || process.env[cfg.kalshi.privateKeyEnv]);

  // We allow running without secrets for development (market fetch will fail), but warn.
  if (!keyId || !privateKeyPem) {
    console.warn('WARNING: Missing Kalshi credentials (KALSHI_KEY_ID / KALSHI_PRIVATE_KEY_PEM). API calls will fail.');
  }

  const logDir = path.resolve(path.dirname(path.resolve(process.cwd(), cfgPath)), cfg.logging.dir);
  const log = jsonlLogger(logDir);
  const broker = new PaperBroker({ log });
  const state = new JsonStateStore({ dir: logDir, filename: 'state.json', log });

  log.write({ t: nowMs(), type: 'boot', cfgPath, mode: cfg.mode, logFile: log.file, stateFile: state.file });

  const client = (keyId && privateKeyPem)
    ? new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem })
    : null;

  const tickerProbe = args.ticker;
  if (tickerProbe) {
    console.log('ticker probe mode enabled');
  }

  let lastSummaryAt = 0;

  while (true) {
    const tickT = nowMs();

    try {
      if (!client) {
        log.write({ t: tickT, type: 'tick', ok: false, reason: 'no_kalshi_client' });
        await sleep(cfg.pollIntervalMs);
        continue;
      }

      // 1) Discover NBA markets
      const discovered = await discoverNbaMarkets({ client, seriesTicker: cfg.nba.seriesTicker });
      log.write({ t: tickT, type: 'discovery', seriesTicker: cfg.nba.seriesTicker, count: discovered.length });

      // 2) Optional ticker probe
      if (tickerProbe) {
        const ob = await client.getOrderbook(tickerProbe, 10);
        const tob = computeTopOfBook(ob);
        const midProb = midProbFromLockedCents(tob.midLockedC);
        const depthYesNearMid = depthNearMid(ob, { side: 'yes', midC: tob.midLockedC, nearC: 1 });
        const skipMicro = shouldSkipByMicrostructure({ tob, cfg });
        log.write({ t: tickT, type: 'market_snapshot', ticker: tickerProbe, tob, midProb, depthYesNearMid, micro: { skip: skipMicro.skip, reason: skipMicro.reason || null } });
      }

      // 3) Per-market monitoring
      for (const m of discovered) {
        if (!m.ticker) continue;
        const ob = await client.getOrderbook(m.ticker, 10);
        const tob = computeTopOfBook(ob);
        const midProb = midProbFromLockedCents(tob.midLockedC);
        const depthYesNearMid = depthNearMid(ob, { side: 'yes', midC: tob.midLockedC, nearC: 1 });
        const skipMicro = shouldSkipByMicrostructure({ tob, cfg });

        const gameId = m.eventTicker || m.ticker;
        const g = state.ensureGame(gameId);

        // Pregame baseline lock is handled after scheduled tip-off via ESPN fallback (locked requirement).
        // We do not use Kalshi open_time, which may be days before tip-off.

        log.write({
          t: tickT,
          type: 'market_snapshot',
          gameId,
          ticker: m.ticker,
          eventTicker: m.eventTicker,
          parsed: m.parsed,
          tob,
          midProb,
          depthYesNearMid,
          micro: { skip: skipMicro.skip, reason: skipMicro.reason || null },
        });

        // --- Game state ---
        // First probe Kalshi endpoints; fall back to ESPN scoreboard.
        const gsk = await fetchGameStateFromKalshi({ client, eventTicker: m.eventTicker, marketTicker: m.ticker });
        log.write({ t: tickT, type: 'game_state', gameId, ticker: m.ticker, ...gsk });

        let gs = null;
        if (!gsk.ok) {
          const p = m.parsed;
          if (p?.ok) {
            const todayIso = new Date().toISOString().slice(0, 10);
            if (p.date !== todayIso) {
              gs = { ok: false, provider: 'espn', reason: 'skip_non_today', updatedAtMs: tickT, isoDate: p.date, todayIso };
            } else {
              gs = await fetchGameStateEspn({ isoDate: p.date, awayAbbr: p.away, homeAbbr: p.home });
            }
          } else {
            gs = { ok: false, provider: 'espn', reason: 'no_parsed_event_ticker', updatedAtMs: tickT };
          }
          log.write({ t: tickT, type: 'game_state_fallback', gameId, ticker: m.ticker, ...gs });
        }

        if (gs?.ok) {
          g.lastEspnStateOk = true;
          g.lastEspnState = gs;
          if (gs.scheduledStartMs && !g.scheduledStartMs) {
            g.scheduledStartMs = gs.scheduledStartMs;
            g.scheduledStartIso = gs.scheduledStartIso;
          }
          state.save();
        }

        // --- Baseline lock ---
        // Lock baseline at first observed Kalshi mid at/after ESPN scheduled tip-off.
        // Also lock which team was the pregame favorite (favoriteTeam) based on the *higher* mid at lock time.
        if (!g.pregameLockedProb && Number.isFinite(g.scheduledStartMs) && tickT >= g.scheduledStartMs) {
          const team = String(m.ticker).split('-').at(-1);
          if (midProb != null) {
            // Track candidates; choose max midProb across team markets.
            const c = g.baselineCandidates || (g.baselineCandidates = {});
            c[team] = midProb;
            // Once we have both teams (or at least one), pick current max.
            let bestTeam = null;
            let bestProb = -1;
            for (const [k, v] of Object.entries(c)) {
              if (Number.isFinite(v) && v > bestProb) { bestProb = v; bestTeam = k; }
            }
            if (bestTeam) {
              g.pregameLockedProb = bestProb;
              g.favoriteTeam = bestTeam;
              g.pregameLockedAtMs = tickT;
              g.pregameLockedAtIso = new Date(tickT).toISOString();
              g.eventTicker = m.eventTicker;
              g.parsed = m.parsed;
              state.save();
              log.write({ t: tickT, type: 'pregame_locked', gameId, favoriteTeam: bestTeam, pregameLockedProb: bestProb, scheduledStartIso: g.scheduledStartIso || null });
            }
          }
        }

        // --- Trading logic (paper) ---
        const pos = broker.getPosition(gameId);

        // Staleness safety for OPEN positions only (3 minutes)
        if (pos && pos.status === 'open') {
          const updatedAt = g.lastEspnStateOk ? g.lastEspnState?.updatedAtMs : null;
          if (Number.isFinite(updatedAt) && (tickT - updatedAt) > cfg.gameState.staleForceExitMs) {
            const exitMid = computeMidProbFromTob(tob);
            broker.closePosition({ gameId, exitPriceC: tob?.midLockedC ?? null, reason: 'stale_force_exit' });
            log.write({ t: tickT, type: 'exit', gameId, ticker: m.ticker, ok: true, reason: 'stale_force_exit', midProb: exitMid });
          }
        }

        // Exit monitor
        if (pos && pos.status === 'open' && g.lastEspnStateOk) {
          const ex = shouldExit({ gameId, ticker: m.ticker, tob, gs: g.lastEspnState, cfg, position: pos });
          log.write({ t: tickT, type: 'exit_check', gameId, ticker: m.ticker, ...ex });
          if (ex.ok) {
            // Close at midLockedC (paper). Fees/PnL calc next.
            broker.closePosition({ gameId, exitPriceC: tob?.midLockedC ?? null, reason: ex.reason });
            log.write({ t: tickT, type: 'exit', gameId, ticker: m.ticker, ok: true, reason: ex.reason, midProb: ex.midProb ?? null });
          }
        }

        // Entry engine
        const ent = shouldEnter({
          gameId,
          ticker: m.ticker,
          tob,
          depthNearMid: depthYesNearMid,
          micro: { skip: skipMicro.skip },
          stateGame: g,
          gs: g.lastEspnStateOk ? g.lastEspnState : null,
          cfg,
          alreadyTraded: broker.hasTradedGame(gameId),
        });
        log.write({ t: tickT, type: 'entry_check', gameId, ticker: m.ticker, ...ent });

        if (ent.ok) {
          // v0: fixed small size; risk sizing to follow.
          const qty = 10;

          // Ensure only one live attempt at a time for this game.
          if (!broker.hasOpenOrderForGame(gameId) && (!pos || pos.status !== 'open')) {
            const order = broker.placeLimit({
              gameId,
              ticker: m.ticker,
              side: 'YES',
              priceC: tob.midLockedC,
              qty,
              goodForMs: cfg.execution.cancelUnfilledAfterMs,
            });
            log.write({ t: tickT, type: 'entry_order_placed', gameId, ticker: m.ticker, orderId: order.id, priceC: order.priceC, qty });
          }
        }

        // Poll open paper orders for this market (fills or expires automatically)
        for (const o of broker.orders.values()) {
          if (o.gameId !== gameId || o.ticker !== m.ticker || o.status !== 'open') continue;
          const fill = broker.pollFill(o.id, { tob });
          log.write({ t: tickT, type: 'entry_order_poll', gameId, ticker: m.ticker, orderId: o.id, fillStatus: fill.status });
        }

        if (nowMs() - lastSummaryAt >= cfg.logging.consoleSummaryEveryMs) {
          lastSummaryAt = nowMs();
          console.log(`[${new Date().toISOString()}] ${m.ticker} mid=${midProb ?? 'n/a'} spreadC=${tob.spreadC ?? 'n/a'} depthNearMid=${depthYesNearMid} locked=${g.pregameLockedProb ?? 'n/a'}`);
        }
      }

    } catch (e) {
      log.write({ t: tickT, type: 'error', msg: String(e?.message || e), stack: e?.stack || null });
    }

    const elapsed = nowMs() - tickT;
    const sleepMs = Math.max(250, cfg.pollIntervalMs - elapsed);
    await sleep(sleepMs);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

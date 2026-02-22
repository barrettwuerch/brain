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
import { fetchGameState } from './game_state_espn.mjs';
import { jsonlLogger, loadEnvFile, nowMs, parseArgs, sleep } from './util.mjs';

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
  const keyId = envFromFile[cfg.kalshi.keyIdEnv] || process.env[cfg.kalshi.keyIdEnv];
  const privateKeyPem = envFromFile[cfg.kalshi.privateKeyEnv] || process.env[cfg.kalshi.privateKeyEnv];

  // We allow running without secrets for development (market fetch will fail), but warn.
  if (!keyId || !privateKeyPem) {
    console.warn('WARNING: Missing Kalshi credentials (KALSHI_KEY_ID / KALSHI_PRIVATE_KEY_PEM). API calls will fail.');
  }

  const logDir = path.resolve(path.dirname(path.resolve(process.cwd(), cfgPath)), cfg.logging.dir);
  const log = jsonlLogger(logDir);
  const broker = new PaperBroker({ log });

  log.write({ t: nowMs(), type: 'boot', cfgPath, mode: cfg.mode, logFile: log.file });

  const client = (keyId && privateKeyPem)
    ? new KalshiClient({ baseUrl: cfg.kalshi.baseUrl, keyId, privateKeyPem })
    : null;

  // TODO: market discovery for NBA live markets.
  // For now, the bot supports passing a single ticker via --ticker for probing.
  const ticker = args.ticker;
  if (!ticker) {
    console.log('v0 scaffold: pass --ticker <KALSHI_TICKER> to probe orderbook + compute mid/spread.');
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

      if (ticker) {
        const ob = await client.getOrderbook(ticker, 10);
        const tob = computeTopOfBook(ob);
        const midProb = midProbFromLockedCents(tob.midLockedC);

        const depthYesNearMid = depthNearMid(ob, { side: 'yes', midC: tob.midLockedC, nearC: 1 });
        const skipMicro = shouldSkipByMicrostructure({ tob, cfg });

        log.write({
          t: tickT,
          type: 'market_snapshot',
          ticker,
          tob,
          midProb,
          depthYesNearMid,
          micro: { skip: skipMicro.skip, reason: skipMicro.reason || null },
        });

        // ESPN integration placeholder
        const gs = await fetchGameState({});
        log.write({ t: tickT, type: 'game_state', ticker, ...gs });

        if (nowMs() - lastSummaryAt >= cfg.logging.consoleSummaryEveryMs) {
          lastSummaryAt = nowMs();
          console.log(`[${new Date().toISOString()}] ${ticker} mid=${midProb ?? 'n/a'} spreadC=${tob.spreadC ?? 'n/a'} depthNearMid=${depthYesNearMid}`);
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

#!/usr/bin/env node
/**
 * diagnose_window_series.mjs
 *
 * Diagnostic: top series by MARKET COUNT within a close-time window.
 *
 * Approach:
 * 1) Fetch events in [minClose,maxClose] to discover which series exist in window.
 * 2) For top N series (by event count), fetch markets for that series in the same window and count markets.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { KalshiClient } from '../lib/kalshi_client.mjs';
import { loadEnvFile } from '../lib/util.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPaged({ kind, fn, paramsBase, maxPages = 200 }) {
  let cursor = null;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const params = { ...paramsBase };
    if (cursor) params.cursor = cursor;

    let resp;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        resp = await fn(params);
        break;
      } catch (e) {
        if (e?.status === 429) {
          await sleep(250 * Math.pow(2, attempt));
          continue;
        }
        throw e;
      }
    }
    if (!resp) throw new Error(`fetchPaged failed after retries (${kind})`);

    const batch = resp?.[kind] || [];
    out.push(...batch);
    cursor = resp?.cursor || resp?.next_cursor || resp?.nextCursor || null;
    if (!cursor || batch.length === 0) break;
    await sleep(80);
  }
  return out;
}

async function main() {
  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/augur_v2/config.paper.json'));
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const envPath = process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env');
  const env = loadEnvFile(envPath);
  const keyId = process.env.KALSHI_API_KEY || env.KALSHI_API_KEY;
  const pkPath = process.env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_PRIVATE_KEY_PATH;
  const baseUrl = (process.env.KALSHI_BASE_URL || env.KALSHI_BASE_URL || cfg.baseUrl).replace(/\/$/, '');
  if (!keyId || !pkPath) throw new Error('Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH');
  const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

  const client = new KalshiClient({ baseUrl, keyId, privateKeyPem });

  const minDays = Number(arg('--minDays', String(cfg.selection.minDaysToSettlement ?? 2)));
  const maxDays = Number(arg('--maxDays', String(cfg.selection.maxDaysToSettlement ?? 21)));
  const topN = Number(arg('--top', '50'));

  const minClose = new Date(Date.now() + minDays * 86400000).toISOString();
  const maxClose = new Date(Date.now() + maxDays * 86400000).toISOString();

  console.log(`Series diagnostic | window days=[${minDays},${maxDays}] | close=[${minClose} .. ${maxClose}]`);

  // 1) Discover series in window
  const events = await fetchPaged({
    kind: 'events',
    fn: (p) => client.getEvents(p),
    paramsBase: { status: 'open', limit: '200', min_close_time: minClose, max_close_time: maxClose },
    maxPages: 80,
  });

  const seriesCounts = new Map();
  for (const e of events) {
    const st = String(e?.series_ticker || '');
    if (!st) continue;
    seriesCounts.set(st, (seriesCounts.get(st) || 0) + 1);
  }

  const rankedByEvents = [...seriesCounts.entries()].sort((a, b) => b[1] - a[1]);

  // 2) For top series, count markets in window
  const results = [];
  const seriesToCheck = rankedByEvents.slice(0, Math.max(topN, 120)).map(([st]) => st);

  for (const st of seriesToCheck) {
    const mkts = await fetchPaged({
      kind: 'markets',
      fn: (p) => client.getMarkets(p),
      paramsBase: { status: 'open', limit: '200', series_ticker: st, min_close_time: minClose, max_close_time: maxClose },
      maxPages: 40,
    });
    const nMarkets = mkts.length;
    if (nMarkets === 0) continue;
    results.push({ series_ticker: st, markets: nMarkets, events: seriesCounts.get(st) || 0 });
  }

  results.sort((a, b) => b.markets - a.markets);

  console.log(`\nTop ${topN} series by MARKET COUNT in window:`);
  for (const r of results.slice(0, topN)) {
    console.log(`${String(r.markets).padStart(5)} markets | ${String(r.events).padStart(4)} events | ${r.series_ticker}`);
  }

  console.log(`\nTotals:`);
  console.log(`events in window: ${events.length}`);
  console.log(`unique series in window: ${seriesCounts.size}`);
  console.log(`series with >=1 market in window (sampled): ${results.length}`);
}

main().catch((e) => {
  console.error('DIAG_FATAL:', e?.message || e);
  if (e?.status) console.error('status:', e.status);
  if (e?.data) console.error('data:', JSON.stringify(e.data, null, 2));
  process.exit(1);
});

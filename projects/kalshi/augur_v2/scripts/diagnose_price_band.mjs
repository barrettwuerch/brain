#!/usr/bin/env node
/**
 * diagnose_price_band.mjs
 *
 * Price diagnostic: in a close-time window, count how many markets have YES_ASK or NO_ASK
 * in the target band (e.g. $0.93–$0.99). This ignores Tier-2 category filters.
 *
 * Uses /markets fields (yes_ask/no_ask, volume, liquidity) to avoid per-market orderbook calls.
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

function to01(priceCentsOrNull) {
  if (priceCentsOrNull == null) return null;
  const n = Number(priceCentsOrNull);
  if (!Number.isFinite(n)) return null;
  // endpoint returns integer cents 0..100
  return n / 100;
}

async function fetchMarketsWindow({ client, minClose, maxClose, limit = 1000, maxPages = 30 }) {
  let cursor = null;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const params = {
      status: 'open',
      limit: String(limit),
      min_close_time: minClose,
      max_close_time: maxClose,
    };
    if (cursor) params.cursor = cursor;

    let resp;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        resp = await client.getMarkets(params);
        break;
      } catch (e) {
        if (e?.status === 429) {
          await sleep(250 * Math.pow(2, attempt));
          continue;
        }
        throw e;
      }
    }
    if (!resp) throw new Error('getMarkets failed after retries');

    const batch = resp.markets || [];
    out.push(...batch);

    cursor = resp.cursor || resp.next_cursor || resp.nextCursor || null;
    if (!cursor || batch.length === 0) break;
    await sleep(100);
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
  const lo = Number(arg('--lo', String(cfg.selection.priceFloor ?? 0.93)));
  const hi = Number(arg('--hi', String(cfg.selection.priceCeiling ?? 0.99)));

  const minClose = new Date(Date.now() + minDays * 86400000).toISOString();
  const maxClose = new Date(Date.now() + maxDays * 86400000).toISOString();

  const markets = await fetchMarketsWindow({ client, minClose, maxClose, limit: 1000, maxPages: 30 });

  let yesHits = 0;
  let noHits = 0;
  let eitherHits = 0;

  let yesHitsVol = 0;
  let noHitsVol = 0;

  const bySeries = new Map();

  for (const m of markets) {
    const yesAsk = to01(m.yes_ask);
    const noAsk = to01(m.no_ask);

    const vol = Number(m.volume || 0);
    const series = String(m.series_ticker || m.event_ticker || '').split('-')[0] || 'UNK';

    const yesOk = (yesAsk != null && yesAsk >= lo && yesAsk <= hi);
    const noOk = (noAsk != null && noAsk >= lo && noAsk <= hi);

    if (yesOk) {
      yesHits++;
      if (vol >= (cfg.selection.minVolumeUsd || 0)) yesHitsVol++;
    }
    if (noOk) {
      noHits++;
      if (vol >= (cfg.selection.minVolumeUsd || 0)) noHitsVol++;
    }
    if (yesOk || noOk) {
      eitherHits++;
      bySeries.set(series, (bySeries.get(series) || 0) + 1);
    }
  }

  const topSeries = [...bySeries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  console.log(`PRICE BAND DIAGNOSTIC | window days=[${minDays},${maxDays}] close=[${minClose}..${maxClose}]`);
  console.log(`band=[${lo.toFixed(2)},${hi.toFixed(2)}] markets_scanned=${markets.length}`);
  console.log(`YES_ASK hits=${yesHits} (vol>=${cfg.selection.minVolumeUsd}: ${yesHitsVol})`);
  console.log(`NO_ASK  hits=${noHits} (vol>=${cfg.selection.minVolumeUsd}: ${noHitsVol})`);
  console.log(`EITHER hits=${eitherHits}`);
  console.log('\nTop series among hits (up to 20):');
  for (const [s, c] of topSeries) console.log(`${String(c).padStart(5)}  ${s}`);
}

main().catch((e) => {
  console.error('DIAG_FATAL:', e?.message || e);
  if (e?.status) console.error('status:', e.status);
  if (e?.data) console.error('data:', JSON.stringify(e.data, null, 2));
  process.exit(1);
});

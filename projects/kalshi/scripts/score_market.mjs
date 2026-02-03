#!/usr/bin/env node
/**
 * score_market.mjs
 *
 * Summarize what FV the bot was using for a specific market from JSONL logs,
 * fetch Kalshi settlement/status, and output a scorecard.
 *
 * Usage:
 *   node projects/kalshi/scripts/score_market.mjs --log projects/kalshi/logs/2026-02-03.jsonl \
 *     --market KXTRUMPMENTION-26FEB04-BORD
 *
 * Output:
 * - counts by fvMode
 * - last seen fv + eventType + keyword
 * - settlement/outcome (when resolved)
 * - a one-line scorecard JSON (easy to append to calibration_log.jsonl)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function readJsonl(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch { /* ignore */ }
  }
  return out;
}

function fmtTs(ms) {
  try {
    const d = new Date(Number(ms));
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function parseEnvFile(s) {
  const out = {};
  for (const line of String(s).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function signPssBase64(privateKeyPem, text) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

async function fetchKalshiMarket({ ticker, baseUrl, keyId, privateKeyPem }) {
  const apiPath = `/trade-api/v2/markets/${ticker}`;
  const method = 'GET';
  const ts = String(Date.now());
  const sig = signPssBase64(privateKeyPem, ts + method + apiPath);

  const res = await fetch(baseUrl.replace(/\/$/, '') + apiPath, {
    method,
    headers: {
      'KALSHI-ACCESS-KEY': keyId,
      'KALSHI-ACCESS-TIMESTAMP': ts,
      'KALSHI-ACCESS-SIGNATURE': sig,
    },
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Kalshi HTTP ${res.status} for ${apiPath}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data?.market || data;
}

function normalizeSettlementToYesNo(mkt) {
  const sv = mkt?.settlement_value ?? mkt?.settlementValue;
  const result = (mkt?.result != null) ? String(mkt.result).toUpperCase() : null;

  if (sv != null && Number.isFinite(Number(sv))) {
    const n = Number(sv);
    if (n >= 50) return { outcome: 'YES', outcomeCents: 100 };
    return { outcome: 'NO', outcomeCents: 0 };
  }
  if (result === 'YES' || result === 'NO') {
    return { outcome: result, outcomeCents: result === 'YES' ? 100 : 0 };
  }
  return { outcome: null, outcomeCents: null };
}

async function main() {
  const logFile = arg('--log');
  const market = arg('--market');
  const withSettlement = String(arg('--with-settlement', 'true')).toLowerCase() !== 'false';
  const appendPath = arg('--append');

  const configPath = arg('--config', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/config.paper.json'));
  const envPath = arg('--env', process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env'));

  if (!logFile) throw new Error('Provide --log <file>');
  if (!market) throw new Error('Provide --market <ticker>');

  const events = readJsonl(logFile);

  const orders = [];
  const fills = [];
  const snaps = [];

  for (const e of events) {
    if (e.type === 'order' && e.market === market) orders.push(e);
    if (e.type === 'fill' && e.market === market) fills.push(e);
    if (e.type === 'snapshot' && e.market === market) snaps.push(e);
  }

  const byMode = {};
  for (const o of orders) {
    const m = String(o.fvMode ?? 'NONE');
    byMode[m] = (byMode[m] || 0) + 1;
  }

  const lastOrder = orders.length ? orders[orders.length - 1] : null;
  const lastSnap = snaps.length ? snaps[snaps.length - 1] : null;

  // Choose a representative FV to score:
  // Prefer the most recent order that has an FV value (typically base_rate/no_base_rate).
  const lastWithFv = [...orders].reverse().find(o => Number.isFinite(Number(o.fv)));
  const predictedFvCents = lastWithFv ? Number(lastWithFv.fv) : null;

  let settlement = null;
  if (withSettlement) {
    try {
      const cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
      const baseUrl = String(cfg.baseUrl || process.env.KALSHI_BASE_URL || 'https://trading-api.kalshi.com').replace(/\/$/, '');
      const env = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
      const keyId = process.env.KALSHI_API_KEY || env.KALSHI_API_KEY;
      const pkPath = process.env.KALSHI_PRIVATE_KEY_PATH || env.KALSHI_PRIVATE_KEY_PATH;
      if (!keyId || !pkPath) throw new Error('Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH');
      const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

      const mkt = await fetchKalshiMarket({ ticker: market, baseUrl, keyId, privateKeyPem });
      const norm = normalizeSettlementToYesNo(mkt);

      settlement = {
        ok: true,
        baseUrl,
        ticker: market,
        status: mkt?.status ?? null,
        close_time: mkt?.close_time ?? null,
        open_time: mkt?.open_time ?? null,
        settlement_value: mkt?.settlement_value ?? null,
        result: mkt?.result ?? null,
        outcome: norm.outcome,
        outcomeCents: norm.outcomeCents,
        yes_bid: mkt?.yes_bid ?? null,
        yes_ask: mkt?.yes_ask ?? null,
        no_bid: mkt?.no_bid ?? null,
        no_ask: mkt?.no_ask ?? null,
        title: mkt?.title ?? null,
        subtitle: mkt?.subtitle ?? null,
        series_ticker: mkt?.series_ticker ?? null,
        event_ticker: mkt?.event_ticker ?? null,
      };
    } catch (e) {
      settlement = {
        ok: false,
        error: String(e?.message || e),
        status: e?.status ?? null,
        data: e?.data ?? null,
      };
    }
  }

  const outcomeCents = settlement?.ok ? settlement?.outcomeCents : null;
  const deltaCents = (Number.isFinite(outcomeCents) && Number.isFinite(predictedFvCents))
    ? (outcomeCents - predictedFvCents)
    : null;

  const scorecard = {
    predictedFvCents,
    predictedProb: Number.isFinite(predictedFvCents) ? predictedFvCents / 100 : null,
    predictedFrom: lastWithFv ? {
      t: lastWithFv.t,
      iso: fmtTs(lastWithFv.t),
      fvMode: lastWithFv.fvMode ?? null,
      eventType: lastWithFv.eventType ?? null,
      keyword: lastWithFv.keyword ?? null,
    } : null,
    outcome: settlement?.ok ? settlement?.outcome : null,
    outcomeCents,
    deltaCents,
    deltaProb: Number.isFinite(deltaCents) ? deltaCents / 100 : null,
  };

  const out = {
    market,
    file: logFile,
    orders: orders.length,
    fills: fills.length,
    snapshots: snaps.length,
    fvModes: byMode,
    scorecard,
    settlement,
    last: {
      order: lastOrder ? {
        t: lastOrder.t,
        iso: fmtTs(lastOrder.t),
        fvMode: lastOrder.fvMode ?? null,
        fv: lastOrder.fv ?? null,
        eventType: lastOrder.eventType ?? null,
        keyword: lastOrder.keyword ?? null,
        side: lastOrder.side ?? null,
        price: lastOrder.price ?? null,
        qty: lastOrder.qty ?? null,
        reason: lastOrder.reason ?? null,
      } : null,
      snapshot: lastSnap ? {
        t: lastSnap.t,
        iso: fmtTs(lastSnap.t),
        tob: lastSnap.tob ?? null,
      } : null,
    },
    orderTimeline: orders.map(o => ({
      t: o.t,
      iso: fmtTs(o.t),
      side: o.side,
      price: o.price,
      qty: o.qty,
      fvMode: o.fvMode ?? null,
      fv: o.fv ?? null,
      eventType: o.eventType ?? null,
      keyword: o.keyword ?? null,
    })),
    fillTimeline: fills.map(f => ({
      t: f.t,
      iso: fmtTs(f.t),
      side: f.side,
      price: f.price,
      qty: f.qty,
      tobMid: f.tobAtFill?.mid ?? null,
      tobSpread: f.tobAtFill?.spread ?? null,
    })),
  };

  // Print a one-line summary first (easy grep), then full JSON.
  const line = {
    market,
    predictedFvCents,
    outcome: scorecard.outcome,
    deltaCents,
    fvMode: scorecard.predictedFrom?.fvMode ?? null,
    eventType: scorecard.predictedFrom?.eventType ?? null,
    keyword: scorecard.predictedFrom?.keyword ?? null,
  };
  const scoreLine = JSON.stringify(line);

  if (appendPath) {
    try {
      fs.appendFileSync(appendPath, scoreLine + '\n');
    } catch (e) {
      // still print to stdout, but surface the append error
      console.error('APPEND_FAILED:', String(e?.message || e), 'path=', appendPath);
    }
  }

  console.log(scoreLine);
  console.log(JSON.stringify(out, null, 2));
}

main();

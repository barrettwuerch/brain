#!/usr/bin/env node
/**
 * bord_debug.mjs
 *
 * Summarize what FV the bot was using for a specific market (BORD) from JSONL logs.
 *
 * Usage:
 *   node projects/kalshi/scripts/bord_debug.mjs --log projects/kalshi/logs/2026-02-03.jsonl \
 *     --market KXTRUMPMENTION-26FEB04-BORD
 *
 * Output:
 * - counts by fvMode
 * - last seen fv + eventType + keyword
 * - side/price/qty history for the market
 */

import fs from 'node:fs';

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

function main() {
  const logFile = arg('--log');
  const market = arg('--market', 'KXTRUMPMENTION-26FEB04-BORD');
  if (!logFile) throw new Error('Provide --log <file>');

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

  const out = {
    market,
    file: logFile,
    orders: orders.length,
    fills: fills.length,
    snapshots: snaps.length,
    fvModes: byMode,
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

  console.log(JSON.stringify(out, null, 2));
}

main();

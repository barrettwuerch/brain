#!/usr/bin/env node
/**
 * report.mjs — Report generator for Kalshi bot JSONL logs.
 *
 * Usage:
 *   node report.mjs --log projects/kalshi/logs/2026-02-03.jsonl
 *   node report.mjs --dir projects/kalshi/logs --date 2026-02-03
 */

import fs from 'node:fs';
import path from 'node:path';

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

function histogram(values, bins) {
  const h = Object.fromEntries(bins.map(b => [b.label, 0]));
  for (const v of values) {
    for (const b of bins) {
      if (v <= b.maxInclusive) { h[b.label]++; break; }
    }
  }
  return h;
}

function avg(xs) {
  if (!xs.length) return null;
  return xs.reduce((a,b)=>a+b,0) / xs.length;
}

function main() {
  const logFile = arg('--log');
  const dir = arg('--dir');
  const date = arg('--date');

  let file;
  if (logFile) file = logFile;
  else if (dir && date) file = path.join(dir, `${date}.jsonl`);
  else throw new Error('Provide --log <file> OR --dir <dir> --date YYYY-MM-DD');

  const events = readJsonl(file);

  const counts = {};
  const marketsSeen = new Set();
  let lastSelection = null;

  const spreads = [];
  const mids = [];
  const fills = [];
  const lastMidByMarket = new Map();

  const perMarket = new Map();
  function ensure(ticker) {
    if (!perMarket.has(ticker)) perMarket.set(ticker, { snapshots: 0, fills: 0, spreads: [], mids: [] });
    return perMarket.get(ticker);
  }

  for (const e of events) {
    const t = e.type || 'unknown';
    counts[t] = (counts[t] || 0) + 1;

    if (t === 'selection') lastSelection = e.selected ?? null;

    if (t === 'snapshot') {
      if (e.market) {
        marketsSeen.add(e.market);
        const pm = ensure(e.market);
        pm.snapshots++;
        const s = e.tob?.spread;
        const m = e.tob?.mid;
        if (Number.isFinite(s)) { spreads.push(s); pm.spreads.push(s); }
        if (Number.isFinite(m)) {
          mids.push(m);
          pm.mids.push(m);
          lastMidByMarket.set(e.market, m);
        }
      }
    }

    if (t === 'fill') {
      fills.push(e);
      if (e.market) {
        const pm = ensure(e.market);
        pm.fills++;
      }
    }
  }

  // PnL estimation (very rough): pair YES+NO fills by market in arrival order.
  // Each fill is a buy; paired YES+NO locks in (100 - yesPrice - noPrice) cents per contract.
  const fillsByMarket = new Map();
  for (const f of fills) {
    const mk = f.market;
    if (!fillsByMarket.has(mk)) fillsByMarket.set(mk, { YES: [], NO: [] });
    fillsByMarket.get(mk)[f.side]?.push(f);
  }

  let grossPnlCents = 0;
  let estFeeCents = 0;
  let pairedContracts = 0;

  for (const [mk, sides] of fillsByMarket.entries()) {
    const pairs = Math.min(sides.YES.length, sides.NO.length);
    for (let i = 0; i < pairs; i++) {
      const y = sides.YES[i];
      const n = sides.NO[i];
      const qty = Math.min(Number(y.qty || 0), Number(n.qty || 0));
      if (!qty) continue;
      const spreadCaptured = 100 - Number(y.price) - Number(n.price);
      grossPnlCents += spreadCaptured * qty;
      // crude maker fee estimate: 2 cents per side per contract
      estFeeCents += qty * 2 * 2;
      pairedContracts += qty;
    }
  }

  const spreadBins = histogram(spreads, [
    { label: '0–1', maxInclusive: 1 },
    { label: '2–3', maxInclusive: 3 },
    { label: '4–6', maxInclusive: 6 },
    { label: '7–10', maxInclusive: 10 },
    { label: '11–20', maxInclusive: 20 },
    { label: '21–40', maxInclusive: 40 },
    { label: '41+', maxInclusive: Infinity },
  ]);

  const marketSummaries = [...perMarket.entries()].map(([ticker, d]) => ({
    ticker,
    snapshots: d.snapshots,
    fills: d.fills,
    avgSpread: avg(d.spreads),
    avgMid: avg(d.mids),
  })).sort((a,b) => (b.fills - a.fills) || (b.snapshots - a.snapshots));

  // Build per-market positions + mark-to-market
  const posByMarket = new Map();
  function ensurePos(market) {
    if (!posByMarket.has(market)) posByMarket.set(market, { yesQty: 0, noQty: 0, yesCost: 0, noCost: 0 });
    return posByMarket.get(market);
  }
  for (const f of fills) {
    const p = ensurePos(f.market);
    const qty = Number(f.qty || 0);
    const price = Number(f.price || 0);
    if (f.side === 'YES') { p.yesQty += qty; p.yesCost += qty * price; }
    if (f.side === 'NO') { p.noQty += qty; p.noCost += qty * price; }
  }

  const positions = [...posByMarket.entries()].map(([market, p]) => {
    const mid = lastMidByMarket.get(market) ?? null;
    const yesAvg = p.yesQty ? (p.yesCost / p.yesQty) : null;
    const noAvg = p.noQty ? (p.noCost / p.noQty) : null;
    let unrealizedCents = null;
    if (Number.isFinite(mid)) {
      unrealizedCents = 0;
      if (p.yesQty) unrealizedCents += (mid - yesAvg) * p.yesQty;
      if (p.noQty) unrealizedCents += ((100 - mid) - noAvg) * p.noQty;
      unrealizedCents = Math.round(unrealizedCents);
    }
    const netYesMinusNo = p.yesQty - p.noQty;
    return { market, yesQty: p.yesQty, noQty: p.noQty, netYesMinusNo, yesAvg, noAvg, mid, unrealizedCents };
  }).sort((a,b) => Math.abs(b.unrealizedCents ?? 0) - Math.abs(a.unrealizedCents ?? 0));

  const totalUnrealizedCents = positions.reduce((s, r) => s + (r.unrealizedCents ?? 0), 0);

  const report = {
    file,
    totals: counts,
    marketsSeen: marketsSeen.size,
    lastSelection,
    spread: {
      samples: spreads.length,
      min: spreads.length ? spreads.reduce((a, b) => Math.min(a, b), Infinity) : null,
      max: spreads.length ? spreads.reduce((a, b) => Math.max(a, b), -Infinity) : null,
      avg: avg(spreads),
      histogram: spreadBins,
    },
    mid: {
      samples: mids.length,
      min: mids.length ? mids.reduce((a, b) => Math.min(a, b), Infinity) : null,
      max: mids.length ? mids.reduce((a, b) => Math.max(a, b), -Infinity) : null,
      avg: avg(mids),
    },
    pnlEstimate: {
      grossCents: grossPnlCents,
      estFeeCents,
      netCents: grossPnlCents - estFeeCents,
      pairedContracts,
      totalFills: fills.length,
      note: 'Estimated. Assumes maker fees ~2c/contract/side. Unpaired fills are open risk and not marked-to-market.',
    },
    mtm: {
      totalUnrealizedCents,
      note: 'Estimated using last logged mid per market. NO valued at (100-mid). Fees not included.'
    },
    positions: positions.slice(0, 200),
    perMarket: marketSummaries.slice(0, 50),
  };

  console.log('=== Kalshi Bot Report ===');
  console.log('log:', file);
  console.log('events:', counts);
  console.log('markets seen:', marketsSeen.size);
  console.log('last selection:', lastSelection);
  console.log('spread samples:', spreads.length, 'avg:', report.spread.avg?.toFixed?.(2) ?? null);
  console.log('fills:', fills.length, 'pairedContracts:', pairedContracts, 'netPnL($):', ((report.pnlEstimate.netCents || 0) / 100).toFixed(2));
  console.log('unrealizedMTM($):', ((report.mtm.totalUnrealizedCents || 0) / 100).toFixed(2));
  console.log('top markets (by fills):', report.perMarket.slice(0, 10).map(m => ({ t: m.ticker, fills: m.fills, avgSpread: m.avgSpread && m.avgSpread.toFixed(1) })));
  console.log('top positions (by |unrealized|):', report.positions.slice(0, 10).map(p => ({ m: p.market, yes: p.yesQty, no: p.noQty, mid: p.mid, unrl$: ((p.unrealizedCents||0)/100).toFixed(2) })));
  console.log('--- JSON ---');
  console.log(JSON.stringify(report, null, 2));
}

main();

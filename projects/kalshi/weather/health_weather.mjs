#!/usr/bin/env node
/**
 * health_weather.mjs
 *
 * One-screen health summary for the Kalshi weather paper bot.
 * Reads the latest JSONL log in projects/kalshi/weather/logs/.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

function fmtMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}m`;
  if (m > 0) return `${m}m${String(ss).padStart(2,'0')}s`;
  return `${ss}s`;
}

function ymdNow() { return new Date().toISOString().slice(0, 10); }

function readJsonl(p, maxLines = 20000) {
  const txt = fs.readFileSync(p, 'utf8');
  const lines = txt.trim().split(/\n/);
  const start = Math.max(0, lines.length - maxLines);
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function latestLogFile(logDir) {
  const files = fs.readdirSync(logDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f, p: path.join(logDir, f), st: fs.statSync(path.join(logDir, f)) }))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return files[0]?.p || null;
}

function cityFromTicker(t) {
  if (!t) return 'UNK';
  const m = String(t).match(/^KXHIGH([A-Z]{2,3})-/);
  return m ? m[1] : 'UNK';
}

function cfgPollIntervalMsFromLog(events) {
  // Try to infer outer-loop cadence from fv_group timestamps (one per event group).
  // We take median delta across recent fv_group entries.
  const groups = events.filter(e => e.type === 'fv_group' && Number.isFinite(e.t)).slice(-60);
  if (groups.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < groups.length; i++) deltas.push(groups[i].t - groups[i - 1].t);
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function main() {
  const logDir = arg('--logdir', path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/weather/logs'));
  const file = arg('--log', null) || latestLogFile(logDir);
  if (!file) throw new Error(`No jsonl logs found in ${logDir}`);

  const events = readJsonl(file, 50000);
  if (!events.length) throw new Error(`No parseable events in ${file}`);

  const now = Date.now();

  // Bot runtime: first/last timestamp seen.
  const ts = events.map(e => e.t).filter(Number.isFinite);
  const firstT = Math.min(...ts);
  const lastT = Math.max(...ts);
  const runtimeMs = lastT - firstT;

  // "Last cycle time": approximate from last few fv_group timestamps.
  const groups = events.filter(e => e.type === 'fv_group' && Number.isFinite(e.t));
  const lastGroups = groups.slice(-6);
  let avgCycleMs = null;
  if (lastGroups.length >= 2) {
    const deltas = [];
    for (let i = 1; i < lastGroups.length; i++) deltas.push(lastGroups[i].t - lastGroups[i - 1].t);
    avgCycleMs = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  }
  // If avgCycleMs is suspiciously small (fv_group logs multiple times per loop), fall back to snapshot cadence.
  if (!(avgCycleMs > 1000)) avgCycleMs = cfgPollIntervalMsFromLog(events) || null;

  // Errors/warnings
  const recent = events.slice(-2000);
  const errCount = recent.filter(e => e.type === 'error').length;
  const warnCount = recent.filter(e => e.type === 'warning').length;
  const lastErr = [...recent].reverse().find(e => e.type === 'error') || null;

  // Fills
  const fills = events.filter(e => e.type === 'fill');
  const fillCount = fills.length;
  const lastFill = fills[fills.length - 1] || null;

  // Large shift events
  const largeShift = groups.filter(g => g.largeShift === true);
  const largeShiftCount = largeShift.length;

  // Smoothed brackets
  const smoothedGroups = groups.filter(g => Number(g.smoothedBrackets || 0) > 0);
  const smoothedGroupCount = smoothedGroups.length;
  const smoothedBracketsTotal = groups.reduce((s, g) => s + Number(g.smoothedBrackets || 0), 0);

  // Positions: take last stdout line snapshot from paper_state.json if exists, else infer from latest out.log? Here: infer from latest log fills.
  // Better: read paper_state.json if present.
  const stateFile = path.join(logDir, 'paper_state.json');
  let positions = {};
  if (fs.existsSync(stateFile)) {
    try { positions = JSON.parse(fs.readFileSync(stateFile, 'utf8'))?.positions || {}; } catch {}
  }

  // Largest position by abs qty
  let largestPos = null;
  for (const [mkt, p] of Object.entries(positions)) {
    const yes = Number(p?.yes || 0);
    const no = Number(p?.no || 0);
    const abs = Math.max(Math.abs(yes), Math.abs(no));
    if (!largestPos || abs > largestPos.abs) largestPos = { market: mkt, yes, no, abs, city: cityFromTicker(mkt) };
  }

  // Open orders: approximate from latest stdout log line if present.
  // We can parse last "snapshot" of openOrders from weather_paper.out.log.
  const outLog = path.join(logDir, 'weather_paper.out.log');
  let openOrders = null;
  let openOrdersByCity = {};
  if (fs.existsSync(outLog)) {
    const outTxt = fs.readFileSync(outLog, 'utf8').trim().split(/\n/);
    const last = outTxt[outTxt.length - 1] || '';
    const m = last.match(/openOrders=(\d+)/);
    if (m) openOrders = Number(m[1]);

    // crude parse positions json to derive city coverage
    const pm = last.match(/positions=(\{.*\})\s+log=/);
    if (pm) {
      try {
        const pos = JSON.parse(pm[1]);
        const byCity = {};
        for (const [ticker, p] of Object.entries(pos)) {
          const c = cityFromTicker(ticker);
          byCity[c] = (byCity[c] || 0) + 1;
        }
        openOrdersByCity = byCity;
      } catch {}
    }
  }

  const lines = [];
  lines.push(`WEATHER BOT HEALTH  |  log=${path.basename(file)}  |  updated=${new Date(lastT).toLocaleString()}`);
  lines.push(`runtime=${fmtMs(runtimeMs)}  lastSeen=${fmtMs(now - lastT)} ago  cycle≈${fmtMs(avgCycleMs)}`);
  lines.push(`openOrders=${openOrders ?? 'n/a'}  openOrders(markets) by city=${JSON.stringify(openOrdersByCity)}`);
  lines.push(`fills=${fillCount}  lastFill=${lastFill ? (new Date(lastFill.filledAtMs || lastFill.t).toLocaleString() + ' ' + (lastFill.market||'')) : 'n/a'}`);
  lines.push(`errors(last2k)=${errCount} warnings(last2k)=${warnCount}  lastError=${lastErr ? (new Date(lastErr.t).toLocaleTimeString() + ' ' + String(lastErr.message||'').slice(0,60)) : 'none'}`);
  lines.push(`largeShiftEvents=${largeShiftCount}  smoothedGroups=${smoothedGroupCount}  smoothedBracketsTotal=${smoothedBracketsTotal}`);
  lines.push(`largestPosition=${largestPos ? `${largestPos.city} ${largestPos.market} yes=${largestPos.yes} no=${largestPos.no}` : 'n/a'}`);

  // Ensure one screen: cap to ~8 lines.
  console.log(lines.join('\n'));
}

main();

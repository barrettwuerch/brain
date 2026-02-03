#!/usr/bin/env node
/**
 * rss_baseline_logger.mjs
 *
 * Purpose: build an RSS-count baseline for our Kalshi news-intensity feature.
 * We record Google News RSS <item> counts for a fixed keyword list over
 * consistent lookback windows. This creates the denominator we need for
 * later spike detection (e.g. March 18).
 *
 * Output: JSONL appended to:
 *   projects/kalshi/news/rss_baseline.jsonl
 *
 * Notes:
 * - Uses Google News RSS search. Counts <item> tags as a cheap proxy.
 * - Throttles requests to be polite.
 */

import fs from 'node:fs';
import path from 'node:path';

const WORKDIR = '/Users/bear/.openclaw/workspace/projects/kalshi/news';
const OUT_FILE = path.join(WORKDIR, 'rss_baseline.jsonl');
const KEYWORDS_TXT = path.join(WORKDIR, 'keywords.txt');
const BASE_RATES_JSON = '/Users/bear/.openclaw/workspace/projects/kalshi/base_rates.json';

function nowMs() { return Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readKeywords() {
  const set = new Set();

  // Seed list
  if (fs.existsSync(KEYWORDS_TXT)) {
    const s = fs.readFileSync(KEYWORDS_TXT, 'utf8');
    for (const line of s.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      set.add(t.toLowerCase());
    }
  }

  // Base-rates coverage keywords (what we actually have opinions for today)
  try {
    const base = JSON.parse(fs.readFileSync(BASE_RATES_JSON, 'utf8'));
    const ets = base?.event_types || {};
    for (const [eventType, kwMap] of Object.entries(ets)) {
      if (!kwMap || typeof kwMap !== 'object') continue;
      for (const k of Object.keys(kwMap)) set.add(String(k).toLowerCase());
    }
  } catch {
    // ignore
  }

  return [...set].sort();
}

async function getGoogleNewsCount(keyword, lookback) {
  // Minimal RSS scanner: count <item> tags.
  const q = encodeURIComponent(`${keyword} when:${lookback}`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  return (xml.match(/<item>/g) || []).length;
}

async function main() {
  const keywords = readKeywords();
  // Short windows are the main signal (avoid saturation); long windows are kept for reference.
  const lookbacks = ['1h', '4h', '12h', '1d', '7d', '30d'];

  const runId = `${new Date().toISOString()}_${Math.random().toString(16).slice(2)}`;
  const startedAtMs = nowMs();

  let ok = 0;
  let fail = 0;

  for (const keyword of keywords) {
    for (const lookback of lookbacks) {
      let count = 0;
      let err = null;
      try {
        count = await getGoogleNewsCount(keyword, lookback);
        ok++;
      } catch (e) {
        fail++;
        err = String(e?.message || e);
      }

      const row = {
        t: nowMs(),
        runId,
        keyword,
        lookback,
        count,
        ok: !err,
        err,
      };

      fs.appendFileSync(OUT_FILE, JSON.stringify(row) + '\n');

      // Throttle (avoid hammering RSS)
      await sleep(300);
    }
  }

  const summary = {
    t: nowMs(),
    runId,
    type: 'rss_baseline_run',
    keywords: keywords.length,
    lookbacks,
    ok,
    fail,
    elapsedMs: nowMs() - startedAtMs,
    outFile: OUT_FILE,
  };
  fs.appendFileSync(OUT_FILE, JSON.stringify(summary) + '\n');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('RSS_BASELINE_FATAL:', e?.message || e);
  process.exit(1);
});

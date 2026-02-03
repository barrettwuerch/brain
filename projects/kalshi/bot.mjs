#!/usr/bin/env node
/**
 * Kalshi Paper Trading Bot (v0.5)
 *
 * Goals:
 * - Mention-market only selection (allowlist + heuristic) with pagination
 * - Quote lifecycle: place + reprice + max-age cancel + stale-vs-ask cancel
 * - Per-market post-fill pause (not global)
 * - JSONL logging from day one
 * - Conservative paper fills (crossing implied ask)
 *
 * IMPORTANT:
 * - This is paper-only. No live orders.
 * - Do not store secrets in repo; read from env file / env vars.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function nowMs() { return Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.trunc(n))); }

function parseEnvFile(s) {
  const out = {};
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function loadEnvFile(p) {
  if (!p || !fs.existsSync(p)) return {};
  return parseEnvFile(fs.readFileSync(p, 'utf8'));
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

class KalshiClient {
  constructor({ baseUrl, keyId, privateKeyPem }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.keyId = keyId;
    this.privateKeyPem = privateKeyPem;
  }

  async signedFetch(method, apiPath, { body, query } = {}) {
    const q = query ? ('?' + new URLSearchParams(query).toString()) : '';
    const fullPath = apiPath + q;
    const ts = String(Date.now());
    const msg = ts + method.toUpperCase() + apiPath; // sign without query
    const sig = signPssBase64(this.privateKeyPem, msg);

    const headers = {
      'KALSHI-ACCESS-KEY': this.keyId,
      'KALSHI-ACCESS-TIMESTAMP': ts,
      'KALSHI-ACCESS-SIGNATURE': sig,
    };

    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(this.baseUrl + fullPath, { method, headers, body: payload });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Kalshi HTTP ${res.status} on ${method} ${apiPath}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  getMarkets(params) {
    return this.signedFetch('GET', '/trade-api/v2/markets', { query: params });
  }

  getMarket(ticker) {
    return this.signedFetch('GET', `/trade-api/v2/markets/${ticker}`);
  }

  getOrderbook(ticker, depth = 1) {
    return this.signedFetch('GET', `/trade-api/v2/markets/${ticker}/orderbook`, { query: { depth: String(depth) } });
  }

  getSeries(params) {
    return this.signedFetch('GET', '/trade-api/v2/series', { query: params });
  }

  getEvents(params) {
    return this.signedFetch('GET', '/trade-api/v2/events', { query: params });
  }
}

function safeMkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function jsonlWriter(dir) {
  safeMkdirp(dir);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${day}.jsonl`);
  return {
    file,
    write: (obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n'),
  };
}

function bestBid(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const [p, q] = levels[0];
  return { price: Number(p), qty: Number(q) };
}

function computeTopOfBook(orderbookResp) {
  const yes = orderbookResp?.orderbook?.yes;
  const no = orderbookResp?.orderbook?.no;
  const yb = bestBid(yes);
  const nb = bestBid(no);
  const ya = (nb && Number.isFinite(nb.price)) ? (100 - nb.price) : null;
  const na = (yb && Number.isFinite(yb.price)) ? (100 - yb.price) : null;
  const mid = (yb && ya != null) ? Math.round((yb.price + ya) / 2) : null;
  const spread = (yb && ya != null) ? (ya - yb.price) : null;
  return { yb, nb, ya, na, mid, spread };
}

class PaperBroker {
  constructor({ maxOpenOrders, stateFile = null, log = null }) {
    this.maxOpenOrders = maxOpenOrders;
    this.orders = new Map(); // id -> order
    this.nextId = 1;
    this.positions = new Map(); // market -> { yes, no }
    this.lastFillAtMs = new Map(); // market -> timestamp
    this.stateFile = stateFile;
    this.log = log;

    // Load persisted positions (paper only) so restarts don't reset risk caps.
    this._loadState();
  }

  _loadState() {
    try {
      if (!this.stateFile) return;
      if (!fs.existsSync(this.stateFile)) return;
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      const pos = parsed?.positions || {};
      for (const [m, p] of Object.entries(pos)) {
        const yes = Number(p?.yes || 0);
        const no = Number(p?.no || 0);
        if (!m) continue;
        this.positions.set(m, { yes, no });
      }
      this.log?.write?.({ t: nowMs(), type: 'paper_state_loaded', stateFile: this.stateFile, markets: this.positions.size });
    } catch (e) {
      this.log?.write?.({ t: nowMs(), type: 'warning', msg: 'paper_state_load_failed', stateFile: this.stateFile });
    }
  }

  _saveState() {
    try {
      if (!this.stateFile) return;
      const obj = { updatedAtMs: nowMs(), positions: Object.fromEntries(this.positions) };
      fs.writeFileSync(this.stateFile, JSON.stringify(obj, null, 2));
    } catch (e) {
      this.log?.write?.({ t: nowMs(), type: 'warning', msg: 'paper_state_save_failed', stateFile: this.stateFile });
    }
  }

  getPosition(market) {
    return { ...(this.positions.get(market) || { yes: 0, no: 0 }) };
  }

  place(order) {
    if (this.orders.size >= this.maxOpenOrders) return { ok: false, reason: 'max_open_orders' };
    const id = `paper_${this.nextId++}`;
    const o = { id, ...order, status: 'open', createdAtMs: nowMs() };
    this.orders.set(id, o);
    return { ok: true, order: o };
  }

  cancel(orderId) {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false, reason: 'not_found' };
    this.orders.delete(orderId);
    return { ok: true, order: o };
  }

  processSnapshot(market, tob, cfg = {}) {
    // Probabilistic fill model:
    // - Deterministic fill if our bid crosses implied ask (we are immediately executable)
    // - Otherwise, if we are at/above best bid in a *tight* market, simulate occasional fills
    //   to model other traders crossing to hit our bid.
    const probAtBestBid = Number(cfg?.probFillAtBestBid ?? 0.02); // ~2% per tick
    const maxSpreadForProbFill = Number(cfg?.maxSpreadForProbFill ?? 6); // cents

    const fills = [];
    for (const [id, o] of this.orders.entries()) {
      if (o.market !== market) continue;
      if (o.status !== 'open') continue;

      let shouldFill = false;

      if (o.side === 'YES') {
        if (tob.ya != null && o.price >= tob.ya) {
          shouldFill = true;
        } else if (tob.yb != null && o.price >= tob.yb.price && tob.spread != null && tob.spread <= maxSpreadForProbFill) {
          shouldFill = Math.random() < probAtBestBid;
        }
      } else if (o.side === 'NO') {
        if (tob.na != null && o.price >= tob.na) {
          shouldFill = true;
        } else if (tob.nb != null && o.price >= tob.nb.price && tob.spread != null && tob.spread <= maxSpreadForProbFill) {
          shouldFill = Math.random() < probAtBestBid;
        }
      }

      if (shouldFill) fills.push(this._fill(id, tob));
    }
    return fills.filter(Boolean);
  }

  _fill(orderId, tobAtFill) {
    const o = this.orders.get(orderId);
    if (!o) return null;
    this.orders.delete(orderId);

    const pos = this.positions.get(o.market) || { yes: 0, no: 0 };
    if (o.side === 'YES') pos.yes += o.qty;
    if (o.side === 'NO') pos.no += o.qty;
    this.positions.set(o.market, pos);
    this._saveState();

    const t = nowMs();
    this.lastFillAtMs.set(o.market, t);

    return {
      orderId,
      market: o.market,
      side: o.side,
      qty: o.qty,
      price: o.price,
      filledAtMs: t,
      tobAtFill,
    };
  }
}

function loadAllowlistSeries(filePath, log) {
  try {
    if (!filePath) return [];
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const series = parsed?.series || [];
    if (!Array.isArray(series)) return [];
    return series.map(s => String(s).toUpperCase()).filter(Boolean);
  } catch (e) {
    log?.write({ t: nowMs(), type: 'warning', msg: 'allowlist_parse_failed', filePath });
    return [];
  }
}

function isMentionMarketFactory({ allowlistSeries }) {
  const strongPatterns = [
    /\bmentioned?\b/i,
    /\bsaid\b/i,
    /\bsays\b/i,
    /\bsay\b/i,
    /\buse the word\b/i,
    /\buse\s+['"]/i,
    /how many times/i,
    /\bwill\s+['"].*['"]\s+be\b/i,
  ];

  return (m) => {
    const series = String(m.series_ticker || '').toUpperCase();

    // Allowlist overrides everything.
    if (allowlistSeries.length && allowlistSeries.includes(series)) return true;

    // Strong structural signal: series ticker contains MENTION.
    if (series.includes('MENTION')) return true;

    const title = String(m.title || '').toLowerCase();
    const subtitle = String(m.subtitle || '').toLowerCase();
    const combined = `${title} ${subtitle}`;

    return strongPatterns.some(p => p.test(combined));
  };
}

async function getMentionSeriesTickers(client, { maxSeries = 50 } = {}) {
  // /series is large; but docs currently return a full list without cursor.
  const resp = await client.getSeries({});
  const series = resp?.series || [];
  const mention = series.filter(s => String(s.category || '').toLowerCase() === 'mentions');
  // stable order: as-is; limit
  return mention.slice(0, maxSeries).map(s => String(s.ticker)).filter(Boolean);
}

async function getEventsForSeries(client, seriesTicker, { limit = 100 } = {}) {
  const resp = await client.getEvents({ series_ticker: seriesTicker, limit: String(limit) });
  return resp?.events || resp?.data || [];
}

async function getMarketsForEvent(client, eventTicker, { limit = 200 } = {}) {
  const resp = await client.getMarkets({ event_ticker: eventTicker, limit: String(limit), status: 'open' });
  return resp?.markets || [];
}

function loadJsonIfExists(p) {
  try {
    if (!p || !fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function parseIsoMs(v) {
  if (!v) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function extractEventTimeMs(mkt) {
  // Prefer market close time; fall back to event time fields if present.
  // We see different shapes across endpoints; be defensive.
  return (
    parseIsoMs(mkt?.close_time) ||
    parseIsoMs(mkt?.closeTime) ||
    parseIsoMs(mkt?.event_start_time) ||
    parseIsoMs(mkt?.eventStartTime) ||
    parseIsoMs(mkt?.open_time) ||
    null
  );
}

function eventModeFromHoursToEvent(hoursToEvent, cfg) {
  const ep = cfg?.eventProximity || {};
  const farH = Number(ep.farModeHours ?? 48);
  const activeH = Number(ep.activeModeHours ?? 4);
  if (!Number.isFinite(hoursToEvent)) return 'UNKNOWN';
  if (hoursToEvent > farH) return 'FAR';
  if (hoursToEvent > activeH) return 'ACTIVE';
  return 'EVENT';
}

function classifyEventTypeFromTickers({ marketTicker, seriesTicker }) {
  const mt = String(marketTicker || '').toUpperCase();
  const st = String(seriesTicker || '').toUpperCase();

  // Fail-safe: explicit mappings only. Unknown => null.
  // More specific patterns first (avoid accidental broad matches).

  // Mention subcategories
  if (mt.startsWith('KXSECPRESSMENTION') || st.includes('SECPRESS')) return 'SEC_PRESS';
  if (mt.startsWith('KXTRUMPMENTION') || st.includes('TRUMP')) return 'TRUMP_SPEECH';

  if (mt.startsWith('KXFOMC') || st.startsWith('KXFOMC') || st.includes('FOMC')) return 'FOMC';
  if (mt.startsWith('KXWH') || st.startsWith('KXWH') || st.includes('WHITE_HOUSE')) return 'WHITE_HOUSE';

  // Add more as discovered (explicitly).
  // if (mt.startsWith('KXMRBEAST')) return 'MRBEAST';

  return null;
}

function parseMentionMarket(mkt) {
  const title = String(mkt?.title || '').trim();
  const subtitle = String(mkt?.subtitle || '').trim();
  const rules1 = String(mkt?.rules_primary || '');
  const rules2 = String(mkt?.rules_secondary || '');
  const series = String(mkt?.series_ticker || '').toUpperCase();
  const ticker = String(mkt?.ticker || mkt?.market_ticker || '').toUpperCase();
  const combined = `${title} ${subtitle}`;

  // Event type classification (fail-safe).
  const eventType = classifyEventTypeFromTickers({ marketTicker: ticker, seriesTicker: series });

  // Keyword extraction priority:
  // 1) custom_strike.Word
  const cs = mkt?.custom_strike;
  if (cs && typeof cs === 'object') {
    const word = cs.Word || cs.word || cs.keyword;
    if (word && typeof word === 'string') {
      const k = word.trim().toLowerCase();
      return { ok: true, keyword: k, variants: [k], matchType: 'exact', eventType, confidence: 0.9, source: 'custom_strike' };
    }
  }

  // 2) quoted term in title/subtitle
  const m1 = combined.match(/['"][^'\"]{1,64}['"]/);
  if (m1) {
    const k = m1[0].slice(1, -1).trim().toLowerCase();
    if (k) return { ok: true, keyword: k, variants: [k], matchType: 'exact', eventType, confidence: 0.8, source: 'title_quote' };
  }

  // 3) patterns like: word 'tariff'
  const m2 = combined.toLowerCase().match(/\bword\s+['\"]([^'\"]{1,64})['\"]/);
  if (m2?.[1]) {
    const k = m2[1].trim().toLowerCase();
    return { ok: true, keyword: k, variants: [k], matchType: 'exact', eventType, confidence: 0.8, source: 'title_word' };
  }

  // 4) fallback to rules text: try to find a quoted word there
  const rulesCombined = (rules1 + '\n' + rules2);
  const m3 = rulesCombined.match(/['\"]([^'\"]{1,64})['\"]/);
  if (m3?.[1]) {
    const k = m3[1].trim().toLowerCase();
    // If rules mention plural/possessive/root policy, treat as root-ish.
    const rootish = /plural|possessive|inflection|root|starts with/i.test(rulesCombined);
    const variants = rootish ? Array.from(new Set([k, k.endsWith('s') ? k : (k + 's')])) : [k];
    return { ok: true, keyword: k, variants, matchType: rootish ? 'root' : 'exact', eventType, confidence: 0.6, source: 'rules_quote' };
  }

  return { ok: false, eventType, reason: 'no_keyword_match' };
}

function normalizeLookbackBucket(lookback) {
  // Our baseline logger records short windows (1h/4h/12h) plus 1d/7d/30d.
  // Map arbitrary lookbacks into one of those buckets.
  const s = String(lookback || '').trim();

  // Hours
  let m = s.match(/^(\d+)h$/i);
  if (m) {
    const h = Number(m[1]);
    if (!Number.isFinite(h)) return '4h';
    if (h <= 1) return '1h';
    if (h <= 6) return '4h';
    if (h <= 18) return '12h';
    return '1d';
  }

  // Days
  m = s.match(/^(\d+)d$/i);
  const days = m ? Number(m[1]) : null;
  if (!Number.isFinite(days)) return '7d';
  if (days <= 1) return '1d';
  if (days <= 10) return '7d';
  return '30d';
}

function loadRssBaselineMap({ file, maxAgeDays = 30 } = {}) {
  try {
    if (!file || !fs.existsSync(file)) return new Map();
    const cutoff = nowMs() - (Number(maxAgeDays) * 86400000);
    const lines = fs.readFileSync(file, 'utf8').split(/\n/).filter(Boolean);

    const buckets = new Map(); // key -> [counts]
    for (const line of lines) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!e || typeof e !== 'object') continue;
      if (e.type === 'rss_baseline_run') continue;
      const t = Number(e.t || 0);
      if (!Number.isFinite(t) || t < cutoff) continue;
      const keyword = String(e.keyword || '').toLowerCase();
      const lookback = String(e.lookback || '');
      const ok = !!e.ok;
      const count = Number(e.count);
      if (!ok || !keyword || !Number.isFinite(count)) continue;
      const key = `${keyword}|${lookback}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(count);
    }

    // median per (keyword, lookback)
    const out = new Map();
    for (const [key, arr] of buckets.entries()) {
      arr.sort((a, b) => a - b);
      const n = arr.length;
      if (!n) continue;
      const median = (n % 2 === 1) ? arr[(n - 1) / 2] : ((arr[n / 2 - 1] + arr[n / 2]) / 2);
      out.set(key, { median, n });
    }
    return out;
  } catch {
    return new Map();
  }
}

function getBaselineCount({ baselineMap, keyword, lookback, fallback }) {
  const k = String(keyword || '').toLowerCase();
  const lb = String(lookback || '');
  const rec = baselineMap?.get?.(`${k}|${lb}`);
  const v = Number(rec?.median);
  if (Number.isFinite(v) && v > 0) return v;
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : 20;
}

async function getGoogleNewsCount(keyword, lookback = '2d') {
  // Minimal RSS scanner: count <item> tags.
  const q = encodeURIComponent(`${keyword} when:${lookback}`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url);
  const xml = await res.text();
  return (xml.match(/<item>/g) || []).length;
}

async function refreshNewsCacheIfNeeded({ fvCfg, newsCache, log, refreshMsOverride }) {
  if (!fvCfg?.newsEnabled) return;
  const refreshMs = Number(refreshMsOverride ?? fvCfg.newsRefreshMs ?? 900000);
  const now = nowMs();

  // refresh every refreshMs
  if ((refreshMs > 0) && (now - (globalThis.__lastNewsScanMs || 0) < refreshMs)) return;
  globalThis.__lastNewsScanMs = now;

  const lookback = fvCfg.newsLookback || '2d';
  const baseline = Number(fvCfg.newsBaselineCount ?? 20);
  const spikeRatio = Number(fvCfg.newsSpikeRatio ?? 1.5);

  // Update counts for all cached keywords (keeps scope bounded to what we've seen/quoted)
  const entries = [...newsCache.entries()];
  if (!entries.length) return;

  for (const [k, prev] of entries) {
    let cnt = 0;
    try { cnt = await getGoogleNewsCount(k, lookback); } catch { cnt = 0; }
    const oldCount = (prev && typeof prev === 'object') ? Number(prev.count ?? 0) : Number(prev ?? 0);
    const ratio = (oldCount > 0) ? (cnt / oldCount) : (cnt > 0 ? Infinity : 1);
    newsCache.set(k, { count: cnt, tsMs: now });

    if (ratio >= spikeRatio) {
      log?.write({ t: now, type: 'news_spike', keyword: k, oldCount, newCount: cnt, ratio, baseline });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/config.paper.json');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const envPath = process.env.KALSHI_ENV_FILE || path.join(os.homedir(), '.openclaw/secrets/kalshi.env');
  const env = { ...loadEnvFile(envPath), ...process.env };
  const keyId = env.KALSHI_API_KEY;
  const pkPath = env.KALSHI_PRIVATE_KEY_PATH;
  if (!keyId || !pkPath) throw new Error(`Missing KALSHI_API_KEY or KALSHI_PRIVATE_KEY_PATH (env file: ${envPath})`);
  const privateKeyPem = fs.readFileSync(pkPath, 'utf8');

  const log = jsonlWriter(cfg.logging.dir);
  const client = new KalshiClient({ baseUrl: cfg.baseUrl, keyId, privateKeyPem });
  const paperStateFile = path.join(cfg.logging.dir, 'paper_state.json');
  const broker = new PaperBroker({ maxOpenOrders: cfg.risk.maxOpenOrders, stateFile: paperStateFile, log });

  // graceful shutdown
  let shuttingDown = false;
  function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.write({ t: nowMs(), type: 'shutdown', signal, openOrders: broker.orders.size, positions: Object.fromEntries(broker.positions) });
    process.exit(0);
  }
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  const allowlistSeries = loadAllowlistSeries(cfg.marketSelection.allowlistFile, log);
  const isMentionMarket = isMentionMarketFactory({ allowlistSeries });

  // FV data
  const fvCfg = cfg?.strategy?.fv || { enabled: false };
  const baseRates = fvCfg.enabled ? loadJsonIfExists(fvCfg.baseRatesPath) : null;
  // Co-occurrence matrix is embedded in base_rates.json as of version>=4; coOccurrencePath is optional.
  const coOccurrence = fvCfg.enabled
    ? (baseRates?.co_occurrence || loadJsonIfExists(fvCfg.coOccurrencePath)?.event_types || null)
    : null;

  const newsCache = new Map(); // keyword -> {count, tsMs}
  let lastNewsScanMs = 0;

  // RSS baseline cache (keyword/lookback -> {median,n})
  const baselinePath = fvCfg.newsBaselinePath || path.join(os.homedir(), '.openclaw/workspace/projects/kalshi/news/rss_baseline.jsonl');
  let baselineMap = new Map();
  let baselineLoadedAtMs = 0;
  function refreshBaselineIfNeeded() {
    const refreshMs = Number(fvCfg.newsBaselineRefreshMs ?? 3600000); // 1h
    if (!baselinePath) return;
    if ((nowMs() - baselineLoadedAtMs) < refreshMs) return;
    baselineMap = loadRssBaselineMap({ file: baselinePath, maxAgeDays: Number(fvCfg.newsBaselineMaxAgeDays ?? 30) });
    baselineLoadedAtMs = nowMs();
    log?.write?.({ t: baselineLoadedAtMs, type: 'rss_baseline_loaded', entries: baselineMap.size, file: baselinePath });
  }

  const latestMids = new Map();
  const marketMeta = new Map(); // ticker -> market object (title/rules/custom_strike)

  let errorStreak = 0;
  let lastSummaryAt = 0;
  let lastSelectionRefresh = 0;
  let selected = [];

  function killSwitchOn() {
    try { return !!(cfg.risk.killSwitchFile && fs.existsSync(cfg.risk.killSwitchFile)); } catch { return false; }
  }

  async function refreshSelection() {
    // 0) If seedMarkets provided, validate and include them first.
    const seeds = (cfg.marketSelection.seedMarkets || []).map(s => String(s).trim()).filter(Boolean);
    const seedMarkets = [];
    for (const t of seeds) {
      try {
        const m = await client.getMarket(t);
        seedMarkets.push(m);
      } catch {
        log.write({ t: nowMs(), type: 'warning', msg: 'seed_market_fetch_failed', ticker: t });
      }
    }

    // 1) Prefer mention series -> events -> markets (bulletproof for category Mentions)
    const seriesTickers = await getMentionSeriesTickers(client, { maxSeries: cfg.marketSelection.maxMentionSeries ?? 30 });

    // Operator allowlist of series tickers (if provided) narrows the set.
    const narrowedSeries = allowlistSeries.length
      ? seriesTickers.filter(t => allowlistSeries.includes(String(t).toUpperCase()))
      : seriesTickers;

    const allMarkets = [...seedMarkets];

    for (const st of narrowedSeries) {
      const events = await getEventsForSeries(client, st, { limit: cfg.marketSelection.maxEventsPerSeries ?? 10 });
      for (const ev of events.slice(0, cfg.marketSelection.maxEventsPerSeries ?? 10)) {
        const et = ev?.event_ticker || ev?.ticker;
        if (!et) continue;
        const ms = await getMarketsForEvent(client, et, { limit: 200 });
        allMarkets.push(...ms);
      }
    }

    // 2) As a fallback, apply heuristic mention detection to any seed markets (already included) and the fetched set.
    const mentionMarketsAll = allMarkets.filter(isMentionMarket);

    // 2b) If configured, restrict to event types we have opinions about (e.g., FOMC/WHITE_HOUSE).
    const allowedEventTypes = (cfg.marketSelection.allowedEventTypes || []).map(s => String(s).toUpperCase());
    const requireBaseRates = !!cfg.marketSelection.requireBaseRates;

    const mentionMarkets = mentionMarketsAll.filter(m => {
      if (!allowedEventTypes.length && !requireBaseRates) return true;
      const parsed = parseMentionMarket(m);
      if (!parsed.ok) return false;
      if (allowedEventTypes.length && !allowedEventTypes.includes(parsed.eventType)) return false;
      if (requireBaseRates) {
        const ok = !!(baseRates?.event_types?.[parsed.eventType]?.[parsed.keyword] != null);
        return ok;
      }
      return true;
    });

    // 3) Rank by spread using summary yes_bid/no_bid when present (require two-sided)
    const ranked = mentionMarkets
      .map(m => {
        const yb = (m.yes_bid != null) ? Number(m.yes_bid) : null;
        const nb = (m.no_bid != null) ? Number(m.no_bid) : null;
        const ya = (nb != null) ? (100 - nb) : null;
        const spread = (yb != null && ya != null) ? (ya - yb) : null;
        return { m, spread };
      })
      .filter(x => x.spread != null)
      .filter(x => x.spread >= cfg.marketSelection.minSpreadCents && x.spread <= cfg.marketSelection.maxSpreadCents)
      .sort((a,b) => b.spread - a.spread);

    if (!ranked.length) {
      log.write({ t: nowMs(), type: 'warning', msg: 'no_mention_markets_found', totalScanned: allMarkets.length, seriesScanned: narrowedSeries.length });
      selected = [];
      return;
    }

    selected = ranked.slice(0, cfg.marketSelection.maxMarkets).map(x => x.m.ticker);
    // cache metadata for selected
    marketMeta.clear();
    for (const x of ranked.slice(0, cfg.marketSelection.maxMarkets)) {
      marketMeta.set(x.m.ticker, x.m);
    }
    log.write({ t: nowMs(), type: 'selection', selected, count: selected.length, seriesScanned: narrowedSeries.length });
  }

  await refreshSelection();
  lastSelectionRefresh = nowMs();

  while (!shuttingDown) {
    const loopStart = nowMs();

    // periodic news refresh (bounded to keywords we've already seen)
    // refresh cadence depends on proximity to the nearest known event among selected markets.
    let minHoursToEvent = Infinity;
    for (const t of selected) {
      const m = marketMeta.get(t);
      const etMs = extractEventTimeMs(m);
      if (!etMs) continue;
      const h = (etMs - loopStart) / 3600000;
      if (h < minHoursToEvent) minHoursToEvent = h;
    }
    const modeForNews = eventModeFromHoursToEvent(minHoursToEvent, cfg);
    const ep = cfg?.eventProximity || {};
    const refreshOverride = (modeForNews === 'EVENT')
      ? Number(ep.newsRefreshMsEvent ?? 60000)
      : (modeForNews === 'ACTIVE')
        ? Number(ep.newsRefreshMsActive ?? 120000)
        : Number(ep.newsRefreshMsFar ?? 900000);

    refreshBaselineIfNeeded();
    await refreshNewsCacheIfNeeded({ fvCfg, newsCache, log, refreshMsOverride: refreshOverride });

    if (killSwitchOn()) {
      log.write({ t: loopStart, type: 'killed', reason: 'kill_switch_file_present' });
      process.exit(0);
    }

    if ((loopStart - lastSelectionRefresh) >= (cfg.marketSelection.selectionRefreshMs || 300000)) {
      lastSelectionRefresh = loopStart;
      try { await refreshSelection(); }
      catch (e) {
        log.write({ t: nowMs(), type: 'warning', msg: 'selection_refresh_failed', message: String(e?.message || e) });
      }
    }

    // A) max order age sweep (once per loop)
    {
      const now = nowMs();
      for (const [id, o] of broker.orders.entries()) {
        const age = now - o.createdAtMs;
        if (age > cfg.strategy.maxOrderAgeMs) {
          const r = broker.cancel(id);
          if (r.ok) log.write({ t: now, type: 'stale_cancel', reason: 'max_age', orderId: id, market: o.market, side: o.side, ageMs: age });
        }
      }
    }

    try {
      for (const ticker of selected) {
        let ob;
        try {
          ob = await client.getOrderbook(ticker, cfg.orderbookDepth ?? 1);
        } catch (e) {
          // If a market closes/resolves or becomes unavailable mid-run, drop it immediately.
          log.write({ t: nowMs(), type: 'warning', msg: 'orderbook_fetch_failed', market: ticker, status: e?.status ?? null, message: String(e?.message || e) });
          selected = selected.filter(x => x !== ticker);
          continue;
        }

        const tob = computeTopOfBook(ob);
        if (Number.isFinite(tob.mid)) latestMids.set(ticker, tob.mid);
        log.write({ t: nowMs(), type: 'snapshot', market: ticker, tob });

        // Market resolution detection (fail-safe): empty/one-sided books usually mean closed or illiquid.
        if (!tob.yb && !tob.nb) {
          log.write({ t: nowMs(), type: 'warning', msg: 'empty_orderbook_drop', market: ticker });
          selected = selected.filter(x => x !== ticker);
          continue;
        }

        // fill simulation
        const fills = broker.processSnapshot(ticker, tob, {
          probFillAtBestBid: cfg.strategy.probFillAtBestBid,
          maxSpreadForProbFill: cfg.strategy.maxSpreadForProbFill,
        });
        for (const f of fills) {
          log.write({ t: nowMs(), type: 'fill', ...f });
        }

        // per-market pause
        const lastFill = broker.lastFillAtMs.get(ticker) || 0;
        if ((nowMs() - lastFill) < cfg.strategy.pauseAfterFillMs) {
          continue;
        }

        // if we can't compute a usable mid/spread, don't quote
        if (tob.mid == null || tob.spread == null) continue;
        if (tob.spread < cfg.strategy.minQuotedSpreadCents) continue;

        const pos = broker.getPosition(ticker);
        const inv = pos.yes - pos.no;
        const skew = clampInt(inv, -(cfg.strategy.skewMaxCents ?? 3), (cfg.strategy.skewMaxCents ?? 3));

        // ---- FV computation (v0.5) ----
        const mkt = marketMeta.get(ticker);
        const parsed = mkt ? parseMentionMarket(mkt) : { ok: false, reason: 'no_market_meta' };

        // Event proximity mode
        const eventTimeMs = extractEventTimeMs(mkt);
        const hoursToEvent = (eventTimeMs != null) ? ((eventTimeMs - nowMs()) / 3600000) : NaN;
        const mode = eventModeFromHoursToEvent(hoursToEvent, cfg);
        const ep = cfg?.eventProximity || {};

        let fv = tob.mid; // fallback
        let fvMode = 'mid_only';
        let extraHalf = 0;
        let orderQtyYes = cfg.strategy.maxOrderQty;
        let orderQtyNo = cfg.strategy.maxOrderQty;

        // Mode multipliers (spread/size). We apply these even in base-rate mode.
        const spreadMult = (mode === 'EVENT')
          ? Number(ep.eventSpreadMultiplier ?? 0.8)
          : (mode === 'ACTIVE')
            ? Number(ep.activeSpreadMultiplier ?? 1.0)
            : Number(ep.farSpreadMultiplier ?? 1.8);

        const sizeMult = (mode === 'EVENT')
          ? Number(ep.eventSizeMultiplier ?? 1.4)
          : (mode === 'ACTIVE')
            ? Number(ep.activeSizeMultiplier ?? 1.0)
            : Number(ep.farSizeMultiplier ?? 0.4);

        if (fvCfg.enabled && parsed.ok && baseRates?.event_types?.[parsed.eventType]?.[parsed.keyword] != null) {
          const base = Number(baseRates.event_types[parsed.eventType][parsed.keyword]);
          let newsAdj = 0;
          let intensity = 1;

          // Mode-aware FV logic:
          // - FAR: base rates only (news disabled)
          // - ACTIVE/EVENT: full FV (base + news)
          const useNews = fvCfg.newsEnabled && (mode === 'ACTIVE' || mode === 'EVENT');

          if (useNews) {
            const k = parsed.keyword;
            const prev = newsCache.get(k);
            let cnt;
            let tsMs = null;
            if (prev && typeof prev === 'object') {
              cnt = Number(prev.count ?? 0);
              tsMs = Number(prev.tsMs ?? null);
            } else if (typeof prev === 'number') {
              cnt = Number(prev);
            } else {
              try {
                cnt = await getGoogleNewsCount(k, fvCfg.newsLookback || '2d');
              } catch {
                cnt = 0;
              }
              tsMs = nowMs();
              newsCache.set(k, { count: cnt, tsMs });
            }

            // Use real RSS baseline when available (bucketed to 1d/7d/30d).
            const lbBucket = normalizeLookbackBucket(fvCfg.newsLookback || '2d');
            const fallbackBaseline = Number(fvCfg.newsBaselineCount ?? 20);
            const baseline = getBaselineCount({ baselineMap, keyword: k, lookback: lbBucket, fallback: fallbackBaseline });
            intensity = baseline > 0 ? (cnt / baseline) : 1;

            // Co-occurrence boost: if other keywords are hot in news, and historically co-occur with k,
            // slightly amplify intensity. (Bounded, one-way boost; fail-safe.)
            let coBoost = 1;
            if (fvCfg.coOccurrenceEnabled && coOccurrence && parsed.eventType && coOccurrence?.[parsed.eventType]?.[k]) {
              // Gather context intensities for recently refreshed keywords.
              const maxContext = Number(fvCfg.coOccurrenceMaxContextKeywords ?? 5);
              const minHot = Number(fvCfg.coOccurrenceMinHotIntensity ?? 1.2);
              const maxAgeMs = Number(fvCfg.coOccurrenceMaxAgeMs ?? 6 * 3600000);
              const lookbackForCtx = lbBucket;

              const ctx = [];
              for (const [kw, v] of newsCache.entries()) {
                const kwLc = String(kw || '').toLowerCase();
                if (!kwLc || kwLc === k) continue;
                const c = (v && typeof v === 'object') ? Number(v.count ?? 0) : Number(v);
                const t = (v && typeof v === 'object') ? Number(v.tsMs ?? 0) : 0;
                if (Number.isFinite(t) && t > 0 && (nowMs() - t) > maxAgeMs) continue;

                const b = getBaselineCount({ baselineMap, keyword: kwLc, lookback: lookbackForCtx, fallback: fallbackBaseline });
                const inten = b > 0 ? (c / b) : 1;
                if (inten < minHot) continue;
                ctx.push({ kw: kwLc, inten });
              }
              ctx.sort((a, b) => b.inten - a.inten);
              const top = ctx.slice(0, maxContext);
              if (top.length) {
                const mat = coOccurrence?.[parsed.eventType]?.[k] || {};
                let wSum = 0;
                let scoreSum = 0;
                let maxHotness = 0;
                for (const it of top) {
                  const w = clamp(it.inten - 1, 0, 2);
                  const co = Number(mat?.[it.kw] ?? 0);
                  if (Number.isFinite(co) && co > 0) {
                    scoreSum += co * w;
                    wSum += w;
                    if (w > maxHotness) maxHotness = w;
                  }
                }
                const score = (wSum > 0) ? (scoreSum / wSum) : 0; // 0..1-ish
                const damp = Number(fvCfg.coOccurrenceBoostDamping ?? 0.5);
                coBoost = clamp(1 + (damp * score * maxHotness), 1, 1.8);
              }
            }

            const sens = Number(fvCfg.newsSensitivity ?? 10);
            const effectiveIntensity = intensity * coBoost;
            newsAdj = clamp((effectiveIntensity - 1.0) * sens, -15, 15);
          }

          const adjusted = clamp(base + newsAdj, 1, 99);
          // If co-occurrence is enabled, treat it as part of the FV computation surface.
          // (We apply it by amplifying newsAdj above; this line remains unchanged.)
          const wBase = Number(fvCfg.blendBaseWeight ?? 0.6);
          const wMid = Number(fvCfg.blendMidWeight ?? 0.4);
          fv = Math.round(clamp(adjusted * wBase + tob.mid * wMid, 1, 99));
          fvMode = (mode === 'FAR') ? 'base_rate_far' : 'base_rate';

          // Conviction sizing (fractional Kelly-ish) — scaled by proximity mode.
          if (fvCfg.convictionSizingEnabled) {
            const samples = Number(baseRates?.samples?.[parsed.eventType]?.count ?? 0);
            const highN = Number(fvCfg.confidenceHighSamples ?? 30);
            const medN = Number(fvCfg.confidenceMedSamples ?? 10);
            let conf = (samples >= highN) ? 'HIGH' : (samples >= medN) ? 'MED' : 'LOW';

            // Optional: cap confidence by event type (useful for high-variance classes like TRUMP_SPEECH).
            const capMap = fvCfg.confidenceCapByEventType || null;
            const cap = capMap && parsed?.eventType ? String(capMap[parsed.eventType] || '').toUpperCase() : '';
            if (cap === 'LOW') conf = 'LOW';
            else if (cap === 'MED' && conf === 'HIGH') conf = 'MED';

            const mid = tob.mid;
            const edgeCents = Math.abs(fv - mid);
            const prefersYes = fv > mid;
            const cm = (conf === 'HIGH') ? 1.0 : (conf === 'MED') ? 0.6 : 0.3;

            const fk = Number(fvCfg.fractionalKelly ?? 0.35);
            const edgeFactor = clamp(edgeCents / 30, 0, 1); // 30c edge saturates
            const kellyMult = clamp(0.25 + fk * edgeFactor * cm, 0.1, 1.0);

            const baseQty = Number(cfg.strategy.maxOrderQty);
            const scaledBaseQty = Math.max(1, Math.round(baseQty * sizeMult));

            const bigger = Math.max(1, Math.round(scaledBaseQty * kellyMult));
            const smaller = Math.max(1, Math.round(scaledBaseQty * Math.max(0.3, kellyMult * 0.5)));
            if (prefersYes) {
              orderQtyYes = bigger;
              orderQtyNo = smaller;
            } else {
              orderQtyNo = bigger;
              orderQtyYes = smaller;
            }
          } else {
            orderQtyYes = Math.max(1, Math.round(orderQtyYes * sizeMult));
            orderQtyNo = Math.max(1, Math.round(orderQtyNo * sizeMult));
          }

        } else if (fvCfg.enabled) {
          // No base rate data: widen and reduce size (low confidence mode)
          extraHalf = Number(fvCfg.noBaseRateExtraHalfSpread ?? 2);
          orderQtyYes = Number(fvCfg.noBaseRateOrderQty ?? 1);
          orderQtyNo = Number(fvCfg.noBaseRateOrderQty ?? 1);
          fvMode = parsed.ok ? 'no_base_rate' : 'parse_failed';
          if (!parsed.ok) {
            log.write({ t: nowMs(), type: 'rules_parse_failed', market: ticker, title: mkt?.title || null, reason: parsed.reason || null });
          }
        }

        const half = Math.max(1, Math.round(cfg.strategy.quoteHalfSpreadCents * spreadMult)) + extraHalf;
        const fairNo = 100 - fv;

        // compute targets around FV (not mid)
        const targetYes = clampInt(fv - half - skew, 1, 99);
        const targetNo = clampInt(fairNo - half + skew, 1, 99);
        // ---- end FV ----

        // B) reprice checks for existing orders in this market
        const now = nowMs();
        for (const [id, o] of broker.orders.entries()) {
          if (o.market !== ticker) continue;

          const desired = (o.side === 'YES') ? targetYes : targetNo;
          const drift = Math.abs(o.price - desired);

          // stale-vs-ask safety
          if (o.side === 'YES' && tob.ya != null && o.price >= tob.ya - cfg.strategy.staleThresholdCents) {
            const r = broker.cancel(id);
            if (r.ok) log.write({ t: now, type: 'stale_cancel', reason: 'too_close_to_ask', orderId: id, market: ticker, side: 'YES', price: o.price, ask: tob.ya });
            continue;
          }
          if (o.side === 'NO' && tob.na != null && o.price >= tob.na - cfg.strategy.staleThresholdCents) {
            const r = broker.cancel(id);
            if (r.ok) log.write({ t: now, type: 'stale_cancel', reason: 'too_close_to_ask', orderId: id, market: ticker, side: 'NO', price: o.price, ask: tob.na });
            continue;
          }

          if (drift >= cfg.strategy.repriceThresholdCents) {
            const old = o.price;
            broker.cancel(id);
            const placed = broker.place({ market: ticker, side: o.side, price: desired, qty: o.qty });
            log.write({ t: now, type: 'reprice', market: ticker, side: o.side, oldPrice: old, newPrice: desired, drift, ok: placed.ok });
          }
        }

        // Position caps should block adding MORE of that side, not both.
        const atYesLimit = pos.yes >= cfg.strategy.maxPositionQtyPerMarket;
        const atNoLimit = pos.no >= cfg.strategy.maxPositionQtyPerMarket;

        // Determine whether we already have open orders on each side
        const hasYes = [...broker.orders.values()].some(o => o.market === ticker && o.side === 'YES');
        const hasNo = [...broker.orders.values()].some(o => o.market === ticker && o.side === 'NO');

        if (!atYesLimit && !hasYes) {
          const r = broker.place({ market: ticker, side: 'YES', price: targetYes, qty: orderQtyYes });
          log.write({ t: nowMs(), type: 'order', mode: 'paper', action: 'place', market: ticker, side: 'YES', price: targetYes, qty: orderQtyYes, ok: r.ok, reason: r.reason || null, fvMode, fv, keyword: parsed?.keyword ?? null, eventType: parsed?.eventType ?? null });
        }
        if (!atNoLimit && !hasNo) {
          const r = broker.place({ market: ticker, side: 'NO', price: targetNo, qty: orderQtyNo });
          log.write({ t: nowMs(), type: 'order', mode: 'paper', action: 'place', market: ticker, side: 'NO', price: targetNo, qty: orderQtyNo, ok: r.ok, reason: r.reason || null, fvMode, fv, keyword: parsed?.keyword ?? null, eventType: parsed?.eventType ?? null });
        }
      }

      errorStreak = 0;
    } catch (err) {
      errorStreak++;
      log.write({ t: nowMs(), type: 'error', errorStreak, message: String(err?.message || err), status: err?.status || null, details: err?.data?.error || null });
      if (errorStreak >= cfg.risk.maxErrorStreak) {
        log.write({ t: nowMs(), type: 'halt', reason: 'max_error_streak' });
        process.exit(2);
      }
    }

    if (cfg.logging.consoleSummaryEveryMs && (loopStart - lastSummaryAt) >= cfg.logging.consoleSummaryEveryMs) {
      lastSummaryAt = loopStart;
      console.log(`[kalshi-paper] markets=${selected.length} openOrders=${broker.orders.size} positions=${JSON.stringify(Object.fromEntries(broker.positions))} log=${log.file}`);
    }

    const elapsed = nowMs() - loopStart;
    await sleep(Math.max(0, cfg.pollIntervalMs - elapsed));
  }
}

main().catch((e) => {
  console.error('BOT_FATAL:', e?.message || e);
  process.exit(1);
});

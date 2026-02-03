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
  constructor({ maxOpenOrders }) {
    this.maxOpenOrders = maxOpenOrders;
    this.orders = new Map(); // id -> order
    this.nextId = 1;
    this.positions = new Map(); // market -> { yes, no }
    this.lastFillAtMs = new Map(); // market -> timestamp
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

function parseMentionMarket(mkt) {
  const title = String(mkt?.title || '').trim();
  const subtitle = String(mkt?.subtitle || '').trim();
  const rules1 = String(mkt?.rules_primary || '');
  const rules2 = String(mkt?.rules_secondary || '');
  const series = String(mkt?.series_ticker || '').toUpperCase();
  const combined = `${title} ${subtitle}`;

  // Event type heuristic (v0.5)
  let eventType = 'OTHER';
  const lc = combined.toLowerCase();
  if (series.includes('FOMC') || lc.includes('fomc') || lc.includes('federal reserve') || lc.includes('powell')) eventType = 'FOMC';
  if (lc.includes('white house') || lc.includes('press briefing') || lc.includes('oval office') || lc.includes('president')) eventType = 'WHITE_HOUSE';

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

async function getGoogleNewsCount(keyword, lookback = '2d') {
  // Minimal RSS scanner: count <item> tags.
  const q = encodeURIComponent(`${keyword} when:${lookback}`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url);
  const xml = await res.text();
  return (xml.match(/<item>/g) || []).length;
}

async function refreshNewsCacheIfNeeded({ fvCfg, newsCache, log }) {
  if (!fvCfg?.newsEnabled) return;
  const refreshMs = Number(fvCfg.newsRefreshMs ?? 900000);
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
  const broker = new PaperBroker({ maxOpenOrders: cfg.risk.maxOpenOrders });

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
    await refreshNewsCacheIfNeeded({ fvCfg, newsCache, log });

    if (killSwitchOn()) {
      log.write({ t: loopStart, type: 'killed', reason: 'kill_switch_file_present' });
      process.exit(0);
    }

    if ((loopStart - lastSelectionRefresh) >= (cfg.marketSelection.selectionRefreshMs || 300000)) {
      lastSelectionRefresh = loopStart;
      try { await refreshSelection(); } catch { /* ignore */ }
    }

    try {
      for (const ticker of selected) {
        const ob = await client.getOrderbook(ticker, cfg.orderbookDepth ?? 1);
        const tob = computeTopOfBook(ob);
        if (Number.isFinite(tob.mid)) latestMids.set(ticker, tob.mid);
        log.write({ t: nowMs(), type: 'snapshot', market: ticker, tob });

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

        let fv = tob.mid; // fallback
        let fvMode = 'mid_only';
        let extraHalf = 0;
        let orderQtyYes = cfg.strategy.maxOrderQty;
        let orderQtyNo = cfg.strategy.maxOrderQty;

        if (fvCfg.enabled && parsed.ok && baseRates?.event_types?.[parsed.eventType]?.[parsed.keyword] != null) {
          const base = Number(baseRates.event_types[parsed.eventType][parsed.keyword]);
          let newsAdj = 0;
          let intensity = 1;

          if (fvCfg.newsEnabled) {
            const k = parsed.keyword;
            const prev = newsCache.get(k);
            let cnt;
            if (prev && typeof prev === 'object') {
              cnt = Number(prev.count ?? 0);
            } else if (typeof prev === 'number') {
              cnt = Number(prev);
            } else {
              try {
                cnt = await getGoogleNewsCount(k, fvCfg.newsLookback || '2d');
              } catch {
                cnt = 0;
              }
              newsCache.set(k, { count: cnt, tsMs: nowMs() });
            }
            const baseline = Number(fvCfg.newsBaselineCount ?? 20);
            intensity = baseline > 0 ? (cnt / baseline) : 1;
            const sens = Number(fvCfg.newsSensitivity ?? 10);
            newsAdj = clamp((intensity - 1.0) * sens, -15, 15);
          }

          const adjusted = clamp(base + newsAdj, 1, 99);
          const wBase = Number(fvCfg.blendBaseWeight ?? 0.6);
          const wMid = Number(fvCfg.blendMidWeight ?? 0.4);
          fv = Math.round(clamp(adjusted * wBase + tob.mid * wMid, 1, 99));
          fvMode = 'base_rate';

          // Conviction sizing (fractional Kelly) — in paper mode just adjusts order quantities.
          if (fvCfg.convictionSizingEnabled) {
            const samples = Number(baseRates?.samples?.[parsed.eventType]?.count ?? 0);
            const highN = Number(fvCfg.confidenceHighSamples ?? 30);
            const medN = Number(fvCfg.confidenceMedSamples ?? 10);
            const conf = (samples >= highN) ? 'HIGH' : (samples >= medN) ? 'MED' : 'LOW';

            const pYes = fv / 100;
            const mid = tob.mid;
            const edgeCents = Math.abs(fv - mid);
            const prefersYes = fv > mid;
            // rough confidence multipliers
            const cm = (conf === 'HIGH') ? 1.0 : (conf === 'MED') ? 0.6 : 0.3;

            // fractional kelly proxy: scale with edge
            const fk = Number(fvCfg.fractionalKelly ?? 0.35);
            const edgeFactor = clamp(edgeCents / 30, 0, 1); // 30c edge saturates
            const sizeMult = clamp(0.25 + fk * edgeFactor * cm, 0.1, 1.0);

            // apply asymmetry: size up on favored side, down on other.
            const baseQty = Number(cfg.strategy.maxOrderQty);
            const bigger = Math.max(1, Math.round(baseQty * sizeMult));
            const smaller = Math.max(1, Math.round(baseQty * Math.max(0.3, sizeMult * 0.5)));
            if (prefersYes) {
              orderQtyYes = bigger;
              orderQtyNo = smaller;
            } else {
              orderQtyNo = bigger;
              orderQtyYes = smaller;
            }
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

        const half = cfg.strategy.quoteHalfSpreadCents + extraHalf;
        const fairNo = 100 - fv;

        // compute targets around FV (not mid)
        const targetYes = clampInt(fv - half - skew, 1, 99);
        const targetNo = clampInt(fairNo - half + skew, 1, 99);
        // ---- end FV ----

        // A) max order age sweep
        const now = nowMs();
        for (const [id, o] of broker.orders.entries()) {
          const age = now - o.createdAtMs;
          if (age > cfg.strategy.maxOrderAgeMs) {
            const r = broker.cancel(id);
            if (r.ok) log.write({ t: now, type: 'stale_cancel', reason: 'max_age', orderId: id, market: o.market, side: o.side, ageMs: age });
          }
        }

        // B) reprice checks for existing orders in this market
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
          log.write({ t: nowMs(), type: 'order', mode: 'paper', action: 'place', market: ticker, side: 'YES', price: targetYes, qty: orderQtyYes, ok: r.ok, reason: r.reason || null, fvMode, fv });
        }
        if (!atNoLimit && !hasNo) {
          const r = broker.place({ market: ticker, side: 'NO', price: targetNo, qty: orderQtyNo });
          log.write({ t: nowMs(), type: 'order', mode: 'paper', action: 'place', market: ticker, side: 'NO', price: targetNo, qty: orderQtyNo, ok: r.ok, reason: r.reason || null, fvMode, fv });
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

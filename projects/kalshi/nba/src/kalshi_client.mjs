import crypto from 'node:crypto';

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

export class KalshiClient {
  constructor({ baseUrl, keyId, privateKeyPem }) {
    if (!baseUrl || !keyId || !privateKeyPem) {
      throw new Error('KalshiClient missing baseUrl/keyId/privateKeyPem');
    }
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

  async getHistoricalCutoff() {
    return this.signedFetch('GET', '/trade-api/v2/historical/cutoff');
  }

  async getHistoricalCandlesticks(ticker, params) {
    return this.signedFetch('GET', `/trade-api/v2/historical/markets/${ticker}/candlesticks`, { query: params });
  }

  async getSeriesMarketCandlesticks(seriesTicker, ticker, params) {
    return this.signedFetch('GET', `/trade-api/v2/series/${seriesTicker}/markets/${ticker}/candlesticks`, { query: params });
  }

  async getBatchCandlesticks(params) {
    // Batch endpoint for pulling multiple markets' candlesticks.
    // Requires: market_tickers (comma-separated), start_ts, end_ts, period_interval.
    return this.signedFetch('GET', '/trade-api/v2/markets/candlesticks', { query: params });
  }

  getEvents(params) {
    return this.signedFetch('GET', '/trade-api/v2/events', { query: params });
  }

  // Not documented in our notes, but likely supported; used to probe if Kalshi exposes game state.
  getEvent(eventTicker) {
    return this.signedFetch('GET', `/trade-api/v2/events/${eventTicker}`);
  }

  getSeries(params) {
    return this.signedFetch('GET', '/trade-api/v2/series', { query: params });
  }
}

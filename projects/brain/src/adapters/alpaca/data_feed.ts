import 'dotenv/config';

import type { OHLCVBar } from './types';

import { getCryptoBars, getLatestQuote } from '../../lib/alpaca';

async function fetchJson(url: string): Promise<any> {
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`fetch failed ${resp.status} for ${url}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export type { OHLCVBar };

export async function getCryptoOHLCV(
  symbol: string,
  timeframe: '1h' | '4h' | '1d',
  limit: number,
): Promise<OHLCVBar[]> {
  const bars = await getCryptoBars(symbol, timeframe, limit);
  return bars.map((b) => ({
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

export async function getCryptoQuote(
  symbol: string,
): Promise<{ bid: number; ask: number; spread: number; timestamp: string }> {
  const q = await getLatestQuote(symbol);
  return q;
}

export async function getBTCDominanceProxy(): Promise<number> {
  try {
    const j = await fetchJson('https://api.coingecko.com/api/v3/global');
    const pct = Number(j?.data?.market_cap_percentage?.btc);
    if (!Number.isFinite(pct)) throw new Error('btc dominance not present');
    return pct;
  } catch (e: any) {
    console.warn('[alpaca.data_feed] btc dominance fetch failed; defaulting to 50:', e?.message ?? e);
    return 50;
  }
}

export async function getFundingRate(
  symbol: string,
): Promise<{ rate: number; direction: 'positive' | 'negative' | 'neutral' }> {
  try {
    // Expect input like BTCUSDT; if given BTC/USD, normalize.
    let s = symbol.replace('/', '').toUpperCase();
    if (!s.endsWith('USDT')) s = s + 'USDT';

    const url = new URL('https://fapi.binance.com/fapi/v1/fundingRate');
    url.searchParams.set('symbol', s);
    url.searchParams.set('limit', '1');

    const j = await fetchJson(url.toString());
    const r = Array.isArray(j) ? j[0] : null;
    const rate = r ? Number(r.fundingRate) : 0;
    const direction: 'positive' | 'negative' | 'neutral' = Math.abs(rate) < 0.0001 ? 'neutral' : rate > 0 ? 'positive' : 'negative';
    return { rate, direction };
  } catch (e: any) {
    console.warn('[alpaca.data_feed] funding rate fetch failed; defaulting neutral:', e?.message ?? e);
    return { rate: 0, direction: 'neutral' };
  }
}

// Quick live verification
if (process.argv[1]?.endsWith('data_feed.ts')) {
  (async () => {
    const symbol = 'BTC/USD';
    const bars = await getCryptoOHLCV(symbol, '4h', 10);
    const quote = await getCryptoQuote(symbol);
    const btcDom = await getBTCDominanceProxy();
    const fr = await getFundingRate('BTCUSDT');

    console.log('bars(last10)', bars.slice(-3));
    console.log('quote', quote);
    console.log('btc_dominance_proxy', btcDom);
    console.log('funding_rate', fr);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

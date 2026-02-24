import 'dotenv/config';

import type { WatchCondition } from '../../types';

import { getCryptoOHLCV, getFundingRate } from '../../adapters/alpaca/data_feed';
import {
  classifyVolatilityRegime,
  computeRealizedVol,
  computeRollingCorrelation,
} from '../../adapters/alpaca/compute';

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
}

export async function fetchMetricValue(
  condition: WatchCondition,
): Promise<{ current: number; previous: number | undefined }> {
  const metric = String(condition.metric);
  const ticker = String(condition.ticker);
  const timeframe = (condition.timeframe as any) || '1h';

  try {
    if (metric === 'price' || metric === 'close_price') {
      const bars = await getCryptoOHLCV(ticker, timeframe, 2);
      const previous = bars.length >= 2 ? bars[bars.length - 2].close : undefined;
      const current = bars.length ? bars[bars.length - 1].close : 0;
      return { current, previous };
    }

    if (metric === 'volume_ratio') {
      const bars = await getCryptoOHLCV(ticker, '1d', 31);
      if (bars.length < 2) return { current: 0, previous: undefined };
      const avgVol = mean(bars.slice(0, 30).map((b) => b.volume));
      const cur = bars[bars.length - 1].volume / Math.max(avgVol, 1);
      return { current: cur, previous: undefined };
    }

    if (metric === 'funding_rate') {
      const fr = await getFundingRate(ticker);
      return { current: Math.abs(fr.rate), previous: undefined };
    }

    if (metric === 'realized_vol') {
      const bars = await getCryptoOHLCV(ticker, '1d', 31);
      const closes = bars.map((b) => b.close);
      return { current: computeRealizedVol(closes), previous: undefined };
    }

    if (metric === 'btc_eth_correlation') {
      const btc = await getCryptoOHLCV('BTC/USD', '1d', 15);
      const eth = await getCryptoOHLCV('ETH/USD', '1d', 15);
      const corr = computeRollingCorrelation(
        btc.map((b) => b.close),
        eth.map((b) => b.close),
      );
      return { current: corr, previous: undefined };
    }

    if (metric === 'vol_regime') {
      const bars = await getCryptoOHLCV(ticker, '1d', 31);
      const closes = bars.map((b) => b.close);
      const rv = computeRealizedVol(closes);
      const regime = classifyVolatilityRegime(rv);
      const encoded = regime === 'low' ? 0 : regime === 'normal' ? 1 : regime === 'elevated' ? 2 : 3;
      return { current: encoded, previous: undefined };
    }

    console.warn('[metric_fetcher] unknown metric:', metric);
    return { current: 0, previous: undefined };
  } catch (e: any) {
    console.warn('[metric_fetcher] fetch failed:', metric, e?.message ?? e);
    return { current: 0, previous: undefined };
  }
}

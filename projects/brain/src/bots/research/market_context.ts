import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { getCryptoOHLCV, getFundingRate, getFundingRateHistory } from '../../adapters/alpaca/data_feed';
import { computeRealizedVol } from '../../adapters/alpaca/compute';

import { getMarket, getMarkets } from '../../lib/kalshi';

function percentileRank(values: number[], x: number): number {
  const xs = values.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return 0.5;
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / xs.length;
}

function encodeVolRegimeToPercentile(regime: string): number {
  const r = String(regime).toLowerCase();
  if (r === 'low') return 0.2;
  if (r === 'normal') return 0.5;
  if (r === 'elevated') return 0.8;
  if (r === 'extreme') return 0.95;
  return 0.5;
}

export async function computeVolRegimePercentile(): Promise<{ percentile: number; regime: string; realized_vol?: number }> {
  // Prefer the Risk Bot published operational_state, but also compute a realized-vol percentile as a backstop.
  let regime = 'normal';
  try {
    const { data } = await supabaseAdmin
      .from('operational_state')
      .select('value,expires_at')
      .eq('domain', 'regime_state')
      .eq('key', 'vol_regime')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    const v: any = (data as any)?.value ?? {};
    if (v?.vol_regime) regime = String(v.vol_regime);
  } catch {}

  // Compute realized vol percentile of the last-30d window vs trailing 365d windows.
  try {
    const bars = await getCryptoOHLCV('BTC/USD', '1d', 365);
    const closes = bars.map((b) => Number(b.close));
    if (closes.length >= 60) {
      const window = 30;
      const vols: number[] = [];
      for (let i = window; i <= closes.length; i++) {
        const slice = closes.slice(i - window, i);
        vols.push(computeRealizedVol(slice));
      }
      const current = vols[vols.length - 1];
      const pct = percentileRank(vols, current);
      return { percentile: pct, regime, realized_vol: current };
    }
  } catch {}

  return { percentile: encodeVolRegimeToPercentile(regime), regime };
}

export async function computeFundingRatePercentile(
  symbol: string = 'BTCUSDT',
): Promise<{ percentile: number | null; rate: number | null; note?: string }> {
  const latest = await getFundingRate(symbol);
  const hist = await getFundingRateHistory({ symbol, limit: 90 });

  // If funding is unavailable due to region restrictions, adapter returns rate=0 and hist empty.
  if (!hist.length) {
    return { percentile: null, rate: latest.rate ?? 0, note: 'funding_rate_history_unavailable' };
  }

  const absRates = hist.map((r) => Math.abs(Number(r.fundingRate)));
  const pct = percentileRank(absRates, Math.abs(latest.rate));
  return { percentile: pct, rate: latest.rate };
}

export async function computeKalshiVolumePercentile(ticker: string): Promise<{ percentile: number; volume_24h: number }> {
  // Compare the market's volume_24h vs a sample of open markets.
  const m = await getMarket(ticker);
  const vol = Number((m as any).volume ?? 0);

  const sample = await getMarkets({ status: 'open', limit: 200 });
  const vols = sample.map((x) => Number((x as any).volume ?? 0));
  const pct = vols.length ? percentileRank(vols, vol) : 0.5;
  return { percentile: pct, volume_24h: vol };
}

export async function computeResearchMarketContext(taskInput: any): Promise<any> {
  const out: any = { as_of: new Date().toISOString() };

  // Vol regime percentile (global)
  out.vol_regime = await computeVolRegimePercentile();

  // Funding rate percentile (crypto only)
  if (String(taskInput?.market_type ?? '').toLowerCase() === 'crypto' || String(taskInput?.desk ?? '').includes('crypto')) {
    out.funding_rate = await computeFundingRatePercentile('BTCUSDT');
  }

  // Kalshi volume percentile (prediction only, if we have a ticker)
  const ticker = String(taskInput?.ticker ?? taskInput?.market_ticker ?? '').trim();
  const mt = String(taskInput?.market_type ?? '').toLowerCase();
  if (ticker && (mt === 'prediction' || mt === 'prediction_markets' || mt === 'kalshi')) {
    out.kalshi_volume = await computeKalshiVolumePercentile(ticker);
  }

  return out;
}

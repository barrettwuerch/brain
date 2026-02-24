// Alpaca crypto adapter computations (pure; no DB, no API)

export function classifyVolatilityRegime(realizedVol: number): 'low' | 'normal' | 'elevated' | 'extreme' {
  const rv = Number(realizedVol);
  if (rv < 0.02) return 'low';
  if (rv <= 0.05) return 'normal';
  if (rv <= 0.1) return 'elevated';
  return 'extreme';
}

export function computeRollingCorrelation(prices1: number[], prices2: number[]): number {
  if (prices1.length !== prices2.length) throw new Error('price arrays must be same length');
  if (prices1.length < 5) throw new Error('need at least 5 points');

  const x = prices1.map(Number);
  const y = prices2.map(Number);

  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x);
  const my = mean(y);

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  if (den === 0) return 0;
  return Math.max(-1, Math.min(1, num / den));
}

export function classifyFundingRate(
  rate: number,
  historicalAvg: number,
): {
  anomaly: boolean;
  direction: 'positive' | 'negative' | 'neutral';
  pressure: 'bearish' | 'bullish' | 'neutral';
} {
  const r = Number(rate);
  const avg = Math.abs(Number(historicalAvg));
  const anomaly = Math.abs(r) > avg * 2;
  const direction: 'positive' | 'negative' | 'neutral' = Math.abs(r) < 0.0001 ? 'neutral' : r > 0 ? 'positive' : 'negative';
  const pressure: 'bearish' | 'bullish' | 'neutral' = direction === 'neutral' ? 'neutral' : direction === 'positive' ? 'bearish' : 'bullish';
  return { anomaly, direction, pressure };
}

export function computeRealizedVol(closes: number[]): number {
  const xs = closes.map(Number);
  if (xs.length < 2) return 0;
  const rets: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i - 1] <= 0 || xs[i] <= 0) continue;
    rets.push(Math.log(xs[i] / xs[i - 1]));
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const varr = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
  const sd = Math.sqrt(varr);
  return sd * Math.sqrt(365);
}

export function scanMarketTrend(prices: number[]): { trend: 'up' | 'down' | 'flat'; changePct: number } {
  const xs = prices.map(Number).filter((n) => Number.isFinite(n));
  if (xs.length < 2) return { trend: 'flat', changePct: 0 };
  const first = xs[0];
  const last = xs[xs.length - 1];
  const changePct = first === 0 ? 0 : (last - first) / Math.abs(first);
  const trend: 'up' | 'down' | 'flat' = Math.abs(changePct) < 0.002 ? 'flat' : changePct > 0 ? 'up' : 'down';
  return { trend, changePct };
}

export function detectVolumeAnomaly(currentVol: number, avgVol: number): { anomaly: boolean; ratio: number } {
  const cur = Number(currentVol);
  const avg = Math.max(Number(avgVol), 1e-9);
  const ratio = cur / avg;
  return { anomaly: ratio >= 2, ratio };
}

export function isCryptoTradeable(
  symbol: string,
  volRegime: string,
  spreadPct: number,
): { tradeable: boolean; reason: string } {
  if (volRegime === 'extreme') return { tradeable: false, reason: 'volatility_extreme' };
  if (Number(spreadPct) > 0.003) return { tradeable: false, reason: 'spread_too_wide' };
  return { tradeable: true, reason: 'ok' };
}

if (process.argv[1]?.endsWith('compute.ts')) {
  console.log('classifyVolatilityRegime(0.015)', classifyVolatilityRegime(0.015));
  console.log('computeRollingCorrelation', computeRollingCorrelation([1, 2, 3, 4, 5], [1, 2, 2.5, 4, 5]));
  console.log('classifyFundingRate', classifyFundingRate(0.0003, 0.0001));
  console.log('computeRealizedVol', computeRealizedVol([100, 101, 99, 103, 104, 102]));
  console.log('isCryptoTradeable', isCryptoTradeable('BTC/USD', 'normal', 0.001));
}

// Trading task computations (pure functions; no DB, no API)

export function trendFromYesPrices(prices: number[]): 'yes' | 'no' | 'flat' {
  if (prices.length < 2) return 'flat';
  const first = prices[0];
  const last = prices[prices.length - 1];
  const diff = last - first;
  const eps = 1; // 1 cent
  if (diff > eps) return 'yes';
  if (diff < -eps) return 'no';
  return 'flat';
}

export function volumeAnomaly(current_volume: number, avg_volume: number): { anomaly: boolean; ratio: number } {
  const ratio = avg_volume > 0 ? current_volume / avg_volume : 0;
  return { anomaly: ratio > 2.0, ratio };
}

export function classifyMomentum(prices: number[]): 'strong_yes' | 'weak_yes' | 'neutral' | 'weak_no' | 'strong_no' {
  if (prices.length < 2) return 'neutral';
  const first = prices[0];
  const last = prices[prices.length - 1];
  const diff = last - first;
  const abs = Math.abs(diff);

  if (abs < 1) return 'neutral';
  if (diff > 0) return abs >= 5 ? 'strong_yes' : 'weak_yes';
  return abs >= 5 ? 'strong_no' : 'weak_no';
}

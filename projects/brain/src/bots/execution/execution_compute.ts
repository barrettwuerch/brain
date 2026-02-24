// Execution Bot computations (pure; no DB, no API)

export function estimateSlippage(openInterest: number): number {
  const oi = Number(openInterest);
  if (oi > 10000) return 0.0005;
  if (oi >= 1000) return 0.001;
  return 0.002;
}

export function computeMarketImpact(orderSize: number, dailyVolume: number): number {
  const impact_ratio = Number(orderSize) / Math.max(Number(dailyVolume) || 0, 1);
  if (impact_ratio > 0.05) return impact_ratio * 0.1;
  return 0;
}

export function isTradeableMarket(
  spread: number,
  avgSpread: number,
  hoursToResolution: number,
): { tradeable: boolean; reason: string } {
  if (Number(hoursToResolution) < 2) return { tradeable: false, reason: 'resolution_within_2_hours' };
  if (Number(spread) > Number(avgSpread) * 2) return { tradeable: false, reason: 'spread_too_wide' };
  return { tradeable: true, reason: 'ok' };
}

export function computePositionSize(
  edgeEstimate: number,
  kellyFraction: number,
  accountEquity: number,
  slippage: number,
): { size: number; maxLoss: number; riskPct: number } {
  const netEdge = Number(edgeEstimate) - Number(slippage);
  if (netEdge <= 0) return { size: 0, maxLoss: 0, riskPct: 0 };
  const kellySize = netEdge * Number(kellyFraction) * Number(accountEquity);
  const size = Math.floor(kellySize);
  const maxLoss = size * Number(slippage);
  const riskPct = Number(accountEquity) > 0 ? maxLoss / Number(accountEquity) : 0;
  return { size, maxLoss, riskPct };
}

export function simulateFill(
  limitPrice: number,
  side: 'yes' | 'no',
  openInterest: number,
): { fillPrice: number; slippage: number; status: 'filled' | 'partial' } {
  const slippage = estimateSlippage(openInterest);
  const fillPrice = side === 'yes' ? Number(limitPrice) + slippage : Number(limitPrice) - slippage;
  const status: 'filled' | 'partial' = Number(openInterest) > 500 ? 'filled' : 'partial';
  return { fillPrice, slippage, status };
}

// Inline smoke test
if (process.argv[1]?.endsWith('execution_compute.ts')) {
  console.log('estimateSlippage(15000)', estimateSlippage(15000));
  console.log('estimateSlippage(5000)', estimateSlippage(5000));
  console.log('estimateSlippage(200)', estimateSlippage(200));
  console.log('computeMarketImpact(100, 1000)', computeMarketImpact(100, 1000));
  console.log('isTradeableMarket hours<2', isTradeableMarket(0.02, 0.01, 1.5));
  console.log('computePositionSize', computePositionSize(0.02, 0.6, 10000, 0.001));
  console.log('simulateFill', simulateFill(0.52, 'yes', 800));
}

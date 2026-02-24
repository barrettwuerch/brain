// Research Bot computations (pure; no DB, no API)

import type { RQSComponents, ResearchFinding } from '../../types';

export function scanMarketTrend(prices: number[]): { trend: 'yes' | 'no' | 'flat'; strength: number } {
  // Linear regression over last 10 points.
  const xs = prices.map((_, i) => i);
  const ys = prices.map(Number);
  const n = ys.length;
  if (n < 2) return { trend: 'flat', strength: 0 };

  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    num += dx * (ys[i] - yMean);
    den += dx * dx;
  }

  const slope = den === 0 ? 0 : num / den;

  // R^2
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yHat = yMean + slope * (xs[i] - xMean);
    ssTot += (ys[i] - yMean) ** 2;
    ssRes += (ys[i] - yHat) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  const flat = Math.abs(slope) < 0.01;
  const trend = flat ? 'flat' : slope > 0 ? 'yes' : 'no';

  return { trend, strength: r2 };
}

export function detectVolumeAnomaly(currentVol: number, avgVol: number): { anomaly: boolean; ratio: number } {
  const ratio = Number(currentVol) / Math.max(Number(avgVol) || 0, 1);
  return { anomaly: ratio > 2.0, ratio };
}

export function classifyMomentum(
  prices: number[],
): { momentum: 'strong_yes' | 'weak_yes' | 'neutral' | 'weak_no' | 'strong_no' } {
  const ys = prices.map(Number);
  if (ys.length < 2) return { momentum: 'neutral' };
  const total_change = ys[ys.length - 1] - ys[0];

  if (total_change > 8) return { momentum: 'strong_yes' };
  if (total_change >= 3) return { momentum: 'weak_yes' };
  if (Math.abs(total_change) < 3) return { momentum: 'neutral' };
  if (total_change >= -8) return { momentum: 'weak_no' };
  return { momentum: 'strong_no' };
}

export function scoreRQS(components: RQSComponents): number {
  return (
    0.25 * components.statistical_rigor +
    0.25 * components.mechanism_clarity +
    0.25 * components.novelty +
    0.25 * components.cost_adjusted_edge
  );
}

export function validateSixQuestions(
  finding: Partial<ResearchFinding>,
): {
  valid: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  function missingStr(name: string, v: any) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string' && v.trim().length === 0) return true;
    return false;
  }

  if (missingStr('description', finding.description)) missing.push('description');
  if (missingStr('mechanism', finding.mechanism)) missing.push('mechanism');
  if (missingStr('failure_conditions', finding.failure_conditions)) missing.push('failure_conditions');
  if (finding.sample_size === null || finding.sample_size === undefined) missing.push('sample_size');
  if (finding.base_rate === null || finding.base_rate === undefined) missing.push('base_rate');
  if (missingStr('recommendation', finding.recommendation)) missing.push('recommendation');

  return { valid: missing.length === 0, missing };
}

// Inline smoke test (dev only)
if (process.argv[1]?.endsWith('research_compute.ts')) {
  console.log('scanMarketTrend', scanMarketTrend([10, 11, 12, 13, 14, 15, 16, 18, 19, 20]));
  console.log('detectVolumeAnomaly', detectVolumeAnomaly(300, 100));
  console.log('classifyMomentum strong_yes', classifyMomentum([10, 12, 13, 15, 20]));
  console.log(
    'scoreRQS',
    scoreRQS({ statistical_rigor: 0.7, mechanism_clarity: 0.7, novelty: 0.4, cost_adjusted_edge: 0.7 }),
  );
}

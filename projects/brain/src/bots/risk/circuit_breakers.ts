import 'dotenv/config';

import type { CircuitBreakerEvent, RiskSnapshot } from '../../types';

import { transitionState } from '../../behavioral/state_manager';
import { evaluateCircuitBreakers } from './risk_compute';

export const DEFAULT_THRESHOLDS = {
  dailyLossLimit: 0.03,
  weeklyDrawdownLimit: 0.07,
  maxDrawdownFromPeak: 0.15, // MUST match FIRM_CONSTITUTION.md
  velocityLimit: 0.08,
  enpMinimum: 2,
};

export const CRYPTO_THRESHOLDS = {
  dailyLossLimit: 0.02,
  weeklyDrawdownLimit: 0.05,
  maxDrawdownFromPeak: 0.12,
  velocityLimit: 0.10,
  enpMinimum: 2,
  btcCrashThreshold: 0.10,
};

export function checkBTCCrash(recentPrices: number[], threshold: number = 0.10): boolean {
  const xs = recentPrices.map(Number).filter((n) => Number.isFinite(n));
  if (xs.length < 2) return false;
  let peak = xs[0];
  let maxDd = 0;
  for (const p of xs) {
    if (p > peak) peak = p;
    const dd = (peak - p) / Math.max(peak, 1e-9);
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd > threshold;
}

export async function fireCircuitBreaker(
  breach: string,
  affectedBotIds: string[],
  metricSnapshot: Record<string, any>,
): Promise<void> {
  const ev: CircuitBreakerEvent = {
    breaker_type: breach,
    triggered_at: new Date().toISOString(),
    trigger_value: Number(metricSnapshot?.value ?? metricSnapshot?.drawdown ?? 0),
    threshold: Number(metricSnapshot?.threshold ?? 0),
    action_taken: 'paused',
  };

  console.log('[circuit_breaker]', ev);

  await Promise.all(
    affectedBotIds.map((botId) => transitionState(botId, 'paused', `circuit_breaker: ${breach}`, metricSnapshot)),
  );
}

export async function checkAndFireBreakers(
  snapshot: RiskSnapshot,
  allActiveBotIds: string[],
  marketType: 'prediction' | 'crypto' = 'prediction',
): Promise<string[]> {
  const thresholds = marketType === 'crypto' ? CRYPTO_THRESHOLDS : DEFAULT_THRESHOLDS;
  const { breacheds } = evaluateCircuitBreakers(snapshot, thresholds as any, marketType);
  for (const b of breacheds) {
    await fireCircuitBreaker(b, allActiveBotIds, { breach: b, snapshot, thresholds });
  }
  return breacheds;
}

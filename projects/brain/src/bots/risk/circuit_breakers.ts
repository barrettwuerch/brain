import 'dotenv/config';

import type { CircuitBreakerEvent, RiskSnapshot } from '../../types';

import { transitionState } from '../../behavioral/state_manager';
import { evaluateCircuitBreakers } from './risk_compute';

const DEFAULT_THRESHOLDS = {
  dailyLossLimit: 0.03,
  weeklyDrawdownLimit: 0.07,
  maxDrawdownFromPeak: 0.15, // MUST match FIRM_CONSTITUTION.md
  velocityLimit: 0.08,
  enpMinimum: 2,
};

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

export async function checkAndFireBreakers(snapshot: RiskSnapshot, allActiveBotIds: string[]): Promise<string[]> {
  const { breacheds } = evaluateCircuitBreakers(snapshot, DEFAULT_THRESHOLDS);
  for (const b of breacheds) {
    await fireCircuitBreaker(b, allActiveBotIds, { breach: b, snapshot, threshold: (DEFAULT_THRESHOLDS as any) });
  }
  return breacheds;
}

export { DEFAULT_THRESHOLDS };

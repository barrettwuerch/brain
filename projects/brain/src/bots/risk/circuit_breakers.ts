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

  // FIX F: Write episode + semantic fact immediately (do not wait for nightly consolidation).
  try {
    const { supabaseAdmin } = await import('../../lib/supabase');

    const snapshot = (metricSnapshot as any)?.snapshot ?? {};
    const regime = String(snapshot?.vol_regime ?? snapshot?.volRegime ?? 'unknown');
    const desk = String((metricSnapshot as any)?.marketType ?? '') === 'crypto' ? 'crypto_markets' : 'prediction_markets';

    await supabaseAdmin.from('episodes').insert({
      task_id: null,
      task_type: 'circuit_breaker_event',
      task_input: {
        breaker_type: ev.breaker_type,
        threshold: ev.threshold,
        actual_value: ev.trigger_value,
      },
      agent_role: 'risk',
      desk,
      bot_id: 'risk-bot-1',
      reasoning: 'Circuit breaker fired autonomously.',
      action_taken: ev as any,
      observation: {
        portfolio_drawdown: snapshot?.drawdown_from_peak ?? snapshot?.portfolioDrawdown ?? null,
        enp: snapshot?.enp ?? snapshot?.effectiveNumPositions ?? null,
        open_positions: snapshot?.open_positions ?? snapshot?.openPositions ?? null,
        regime,
        triggered_at: ev.triggered_at,
      },
      reflection: 'Circuit breaker activation. Review portfolio conditions and market regime that led to this event.',
      lessons: [],
      outcome: 'incorrect',
      outcome_score: 0,
      reasoning_score: 0.5,
      error_type: 'regime_mismatch',
      ttl_days: 30,
      embedding: null,
      vol_regime: regime,
    });

    await supabaseAdmin.from('semantic_facts').insert({
      domain: 'risk',
      fact: `[FAILURE PATTERN] circuit_breaker_event: ${ev.breaker_type} fired. portfolio_drawdown=${String(snapshot?.drawdown_from_peak ?? 'n/a')} ENP=${String(snapshot?.enp ?? 'n/a')} regime=${regime}. Review conditions before resuming.`,
      fact_type: 'failure_pattern',
      supporting_episode_ids: [],
      confidence: 0.8,
      times_confirmed: 1,
      times_violated: 0,
      status: 'active',
    });

    console.log(`[CIRCUIT BREAKER] ${ev.breaker_type} fired — episode + semantic fact written immediately`);
  } catch {}
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

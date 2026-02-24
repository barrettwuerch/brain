// Risk Bot computations (pure; no DB, no API, no side effects)

import type { RiskSnapshot } from '../../types';

export function getKellyMultiplier(drawdownFromPeak: number): number {
  const d = Number(drawdownFromPeak);
  if (d <= 0.05) return 1.0;
  if (d <= 0.10) return 0.6;
  if (d <= 0.15) return 0.3;
  if (d <= 0.20) return 0.1;
  return 0.0;
}

export function computeENP(correlationMatrix: number[][]): number {
  // ENP = (Σ all elements)² / Σ (each element squared)
  let sum = 0;
  let sumSq = 0;
  for (const row of correlationMatrix) {
    for (const v0 of row) {
      const v = Number(v0);
      if (!Number.isFinite(v)) continue;
      sum += v;
      sumSq += v * v;
    }
  }
  const num = sum * sum;
  return sumSq === 0 ? 0 : num / sumSq;
}

export function drawdownToRecoveryRequired(drawdownPct: number): number {
  const d = Number(drawdownPct);
  if (d >= 1) return Infinity;
  if (d <= 0) return 0;
  return d / (1 - d);
}

export function computeProfitFactor(outcomescores: number[]): number {
  const xs = outcomescores.map(Number).filter((n) => Number.isFinite(n));
  const gross_wins = xs.filter((s) => s > 0.5).reduce((a, b) => a + b, 0);
  const gross_losses = xs.filter((s) => s <= 0.5).reduce((a, s) => a + (1 - s), 0);
  return gross_wins / Math.max(gross_losses, 0.001);
}

export function computeDrawdownVelocity(drawdownPct: number, tradesSincePeak: number): number {
  return Number(drawdownPct) / Math.max(Number(tradesSincePeak) || 0, 1);
}

export function evaluateCircuitBreakers(
  snapshot: RiskSnapshot,
  thresholds: {
    dailyLossLimit: number;
    weeklyDrawdownLimit: number;
    maxDrawdownFromPeak: number;
    velocityLimit: number;
    enpMinimum: number;
  },
): { breacheds: string[]; actions: string[] } {
  const breacheds: string[] = [];
  const actions: string[] = [];

  const dd = Number(snapshot.drawdown_from_peak ?? 0);
  const vel = Number(snapshot.drawdown_velocity ?? 0);
  const enp = Number(snapshot.enp ?? 0);

  // dailyLossLimit / weeklyDrawdownLimit are not directly in RiskSnapshot yet.
  // For mocked tasks we treat unrealized_pnl as a daily loss percent if it is negative.
  const pnl = Number(snapshot.unrealized_pnl ?? 0);

  if (pnl <= -Math.abs(thresholds.dailyLossLimit)) {
    breacheds.push('daily_loss_limit');
    actions.push('halt_new_entries_today');
  }

  if (dd >= Math.abs(thresholds.weeklyDrawdownLimit)) {
    breacheds.push('weekly_drawdown_limit');
    actions.push('halt_new_entries_this_week');
  }

  if (dd >= Math.abs(thresholds.maxDrawdownFromPeak)) {
    breacheds.push('max_drawdown_from_peak');
    actions.push('halt_all_trading');
  }

  if (vel >= Math.abs(thresholds.velocityLimit)) {
    breacheds.push('drawdown_velocity');
    actions.push('halt_new_entries_immediately');
  }

  if (enp > 0 && enp < thresholds.enpMinimum) {
    breacheds.push('concentration_enp');
    actions.push('halt_new_entries_on_correlated_instruments');
  }

  return { breacheds, actions };
}

// Inline smoke test
if (process.argv[1]?.endsWith('risk_compute.ts')) {
  console.log('getKellyMultiplier(0.12)', getKellyMultiplier(0.12));
  console.log('computeENP([[1,0.8],[0.8,1]])', computeENP([
    [1, 0.8],
    [0.8, 1],
  ]), '(note: formula uses all elements; 2x2 yields 3.95)');
  console.log('drawdownToRecoveryRequired(0.5)', drawdownToRecoveryRequired(0.5));
  console.log('computeProfitFactor([1,1,0,1,0])', computeProfitFactor([1, 1, 0, 1, 0]));
  console.log('computeDrawdownVelocity(0.16, 5)', computeDrawdownVelocity(0.16, 5));
  console.log(
    'evaluateCircuitBreakers',
    evaluateCircuitBreakers(
      {
        timestamp: new Date().toISOString(),
        open_positions: 5,
        unrealized_pnl: -0.04,
        drawdown_from_peak: 0.16,
        drawdown_velocity: 0.09,
        kelly_multiplier: 0.1,
        enp: 1.5,
        active_breakers: [],
        warnings: [],
      },
      {
        dailyLossLimit: 0.03,
        weeklyDrawdownLimit: 0.07,
        maxDrawdownFromPeak: 0.15,
        velocityLimit: 0.08,
        enpMinimum: 2,
      },
    ),
  );
}

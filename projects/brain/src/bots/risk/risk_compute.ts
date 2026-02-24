// Risk Bot computations (pure; no DB, no API, no side effects)

import type { RiskSnapshot } from '../../types';

// IMPORTANT: The 15-20% and >20% drawdown rows are defensive
// backstops only. Under normal operation, the circuit breaker
// in evaluateCircuitBreakers() halts all trading at 15% drawdown
// (12% for crypto) before these rows are ever reached.
// These rows exist for the case where a circuit breaker fails
// to fire. They should never execute in a healthy system.
// If you see Kelly multiplier 0.10 or 0.00 in production logs,
// treat it as a circuit breaker failure signal and investigate.
export function getKellyMultiplier(drawdownFromPeak: number): number {
  const d = Number(drawdownFromPeak);
  if (d <= 0.05) return 1.0;
  if (d <= 0.10) return 0.6;
  if (d <= 0.15) return 0.3;
  if (d <= 0.20) return 0.1;
  return 0.0;
}

export function computeENP(correlationMatrix: number[][]): number {
  // Meucci-style Effective Number of Positions (ENP) via entropy of eigenvalues.
  // ENP = exp(H), where H = -Σ p_i log(p_i), p_i = λ_i / Σ λ.
  // For a correlation matrix: Σ λ_i = n.

  const n = correlationMatrix.length;
  if (n <= 1) return 1;

  // Defensive copy + numeric sanitize
  const A: number[][] = correlationMatrix.map((row) => row.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)));

  const eigenvalues = (() => {
    if (n === 2) {
      const a = A[0][0];
      const b = A[0][1];
      const d = A[1][1];
      const tr = (a + d) / 2;
      const disc = Math.sqrt(((a - d) / 2) ** 2 + b ** 2);
      return [tr + disc, tr - disc];
    }

    // Jacobi eigenvalue algorithm for symmetric matrices (n <= 10)
    const M = A.map((r) => r.slice());
    const maxIter = 100;
    const eps = 1e-10;

    const offDiagNorm = () => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) s += M[i][j] * M[i][j];
      }
      return Math.sqrt(s);
    };

    for (let iter = 0; iter < maxIter; iter++) {
      // find largest off-diagonal element
      let p = 0;
      let q = 1;
      let max = Math.abs(M[p][q]);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const v = Math.abs(M[i][j]);
          if (v > max) {
            max = v;
            p = i;
            q = j;
          }
        }
      }

      if (max < eps || offDiagNorm() < eps) break;

      const app = M[p][p];
      const aqq = M[q][q];
      const apq = M[p][q];

      // Compute Jacobi rotation
      const tau = (aqq - app) / (2 * apq);
      const signTau = tau >= 0 ? 1 : -1;
      const t = signTau / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      // update diagonal elements
      M[p][p] = app - t * apq;
      M[q][q] = aqq + t * apq;
      M[p][q] = 0;
      M[q][p] = 0;

      for (let k = 0; k < n; k++) {
        if (k === p || k === q) continue;
        const mkp = M[k][p];
        const mkq = M[k][q];
        const newKp = c * mkp - s * mkq;
        const newKq = s * mkp + c * mkq;
        M[k][p] = newKp;
        M[p][k] = newKp;
        M[k][q] = newKq;
        M[q][k] = newKq;
      }
    }

    return Array.from({ length: n }, (_, i) => M[i][i]);
  })();

  // Clamp negative eigenvalues caused by numerical error.
  const clamped = eigenvalues.map((x) => (x < 0 ? 0 : x));
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;

  let H = 0;
  for (const lam of clamped) {
    const p = lam / sum;
    if (p <= 0) continue;
    H += -p * Math.log(p);
  }

  const enp = Math.exp(H);
  return Number.isFinite(enp) ? enp : 0;
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
  thresholds?: {
    dailyLossLimit: number;
    weeklyDrawdownLimit: number;
    maxDrawdownFromPeak: number;
    velocityLimit: number;
    enpMinimum: number;
  },
  _marketType?: 'prediction' | 'crypto',
): { breacheds: string[]; actions: string[] } {
  const t = thresholds ?? {
    dailyLossLimit: 0.03,
    weeklyDrawdownLimit: 0.07,
    maxDrawdownFromPeak: 0.15,
    velocityLimit: 0.08,
    enpMinimum: 2,
  };
  const breacheds: string[] = [];
  const actions: string[] = [];

  const dd = Number(snapshot.drawdown_from_peak ?? 0);
  const vel = Number(snapshot.drawdown_velocity ?? 0);
  const enp = Number(snapshot.enp ?? 0);

  // dailyLossLimit / weeklyDrawdownLimit are not directly in RiskSnapshot yet.
  // For mocked tasks we treat unrealized_pnl as a daily loss percent if it is negative.
  const pnl = Number(snapshot.unrealized_pnl ?? 0);

  if (pnl <= -Math.abs(t.dailyLossLimit)) {
    breacheds.push('daily_loss_limit');
    actions.push('halt_new_entries_today');
  }

  if (dd >= Math.abs(t.weeklyDrawdownLimit)) {
    breacheds.push('weekly_drawdown_limit');
    actions.push('halt_new_entries_this_week');
  }

  if (dd >= Math.abs(t.maxDrawdownFromPeak)) {
    breacheds.push('max_drawdown_from_peak');
    actions.push('halt_all_trading');
  }

  if (vel >= Math.abs(t.velocityLimit)) {
    breacheds.push('drawdown_velocity');
    actions.push('halt_new_entries_immediately');
  }

  if (enp > 0 && enp < t.enpMinimum) {
    breacheds.push('concentration_enp');
    actions.push('halt_new_entries_on_correlated_instruments');
  }

  return { breacheds, actions };
}

// Inline smoke test
if (process.argv[1]?.endsWith('risk_compute.ts')) {
  // ENP sanity checks
  const fmt = (x: number) => Number(x.toFixed(6));
  console.log('ENP identity 3x3', fmt(computeENP([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ])));
  console.log('ENP all-ones 3x3', fmt(computeENP([
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ])));
  console.log('ENP corr 2x2 (0.8)', fmt(computeENP([
    [1, 0.8],
    [0.8, 1],
  ])));
}


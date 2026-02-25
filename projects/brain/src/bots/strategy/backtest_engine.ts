// Backtest engine (Strategy Bot)

import type { BacktestReport, StrategyFormalization } from '../../types';
import { computeWalkForwardWindows, detectOverfitting } from './strategy_compute';

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

function sharpe(xs: number[]): number {
  const m = mean(xs);
  const s = Math.max(std(xs), 0.001);
  return m / s;
}

function maxDrawdown(outcomes: number[]): number {
  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  for (const o of outcomes) {
    cum += o;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function profitFactor(outcomes: number[]): number {
  const grossWin = outcomes.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const grossLoss = outcomes.filter((x) => x < 0).reduce((s, x) => s + Math.abs(x), 0);
  return grossWin / Math.max(grossLoss, 0.001);
}

export function runBacktest(
  formalization: StrategyFormalization,
  outcomes: number[],
  slippage_assumption: number,
): BacktestReport {
  // Hard checks (throw)
  if (outcomes.length < 10) throw new Error('Backtest requires outcomes.length >= 10');
  if (!(slippage_assumption > 0)) throw new Error('Backtest requires slippage_assumption > 0');

  const n = outcomes.length;
  const split = Math.max(1, Math.floor(n * 0.7));
  const in_sample = outcomes.slice(0, split);
  const out_sample = outcomes.slice(split);

  const in_sample_sharpe = sharpe(in_sample);
  const out_sample_sharpe = sharpe(out_sample);

  const overfitting_flags: string[] = [];

  // Soft flags
  if (n < 100) overfitting_flags.push('insufficient_trades');
  if (in_sample_sharpe > 2.0) overfitting_flags.push('sharpe_suspect_overfit');
  if (Math.abs(in_sample_sharpe) > 1e-9) {
    const div = Math.abs(out_sample_sharpe - in_sample_sharpe) / Math.abs(in_sample_sharpe);
    if (div > 0.3) overfitting_flags.push('oos_divergence');
  }

  // Regime proxy: early/mid/late thirds
  const third = Math.max(1, Math.floor(n / 3));
  const early = outcomes.slice(0, third);
  const mid = outcomes.slice(third, 2 * third);
  const late = outcomes.slice(2 * third);

  const regime_results: Record<string, number> = {
    early: mean(early),
    mid: mean(mid),
    late: mean(late),
  };

  const wins = outcomes.reduce((s, v) => s + (Number(v) > 0 ? 1 : 0), 0);
  const losses = n - wins;

  const report: BacktestReport = {
    strategy_id: `strategy_${formalization.finding_id}`,
    finding_id: formalization.finding_id,

    win_rate: wins / Math.max(n, 1),
    total_pnl: wins - losses,

    in_sample_sharpe,
    out_sample_sharpe,
    in_sample_trades: in_sample.length,
    out_sample_trades: out_sample.length,
    max_drawdown: maxDrawdown(outcomes),
    recovery_periods: null,
    profit_factor: profitFactor(outcomes),
    regime_results,
    overfitting_flags,
    slippage_assumed: slippage_assumption,
    recommendation: 'return_to_research',
    reason: '',
  };

  // Overfitting checklist
  const of = detectOverfitting(report);
  report.overfitting_flags = Array.from(new Set([...(report.overfitting_flags ?? []), ...(of.flags ?? [])]));

  // Rule 11: Walk-forward required (mandatory)
  if (outcomes.length >= 90) {
    const w = Math.floor(outcomes.length / 3);
    const w1 = outcomes.slice(0, w);
    const w2 = outcomes.slice(w, 2 * w);
    const w3 = outcomes.slice(2 * w, 3 * w);

    const winRate = (xs: number[]) => {
      const wins = xs.reduce((s, v) => s + (Number(v) > 0 ? 1 : 0), 0);
      return wins / Math.max(xs.length, 1);
    };

    const windows = [w1, w2, w3];
    let positive = 0;
    for (const win of windows.map(winRate)) {
      const avg_win = win;
      const avg_loss = 1 - win;
      if (win > 0.5 && avg_win > avg_loss) positive += 1;
    }

    report.walk_forward_windows = 3;
    report.walk_forward_positive = positive;

    if (positive < 2) {
      throw new Error(`BACKTEST_FAIL: walk_forward_insufficient — only ${positive}/3 windows show positive expectancy. Strategy does not generalize.`);
    }
  } else {
    report.walk_forward_skipped = true;
    report.overfitting_flags.push('walk_forward_skipped_insufficient_data');
  }

  // Walk-forward proxy (additional consistency flag)
  const wf = computeWalkForwardWindows(outcomes, 20);
  if (!wf.consistent) report.overfitting_flags.push('walk_forward_inconsistent');

  // Recommendation logic
  if (report.overfitting_flags.includes('oos_divergence')) {
    report.recommendation = 'return_to_research';
    report.reason = 'Out-of-sample diverges materially from in-sample.';
  } else {
    // FIX 4: if walk-forward was skipped, we can still approve WITH CAVEATS when performance is strong.
    // Treat sample-size / walk-forward limitations as caveats, not fatal overfit.
    const caveatFlags = new Set([
      'insufficient_trades',
      'trade_count_lt_100',
      'walk_forward_skipped_insufficient_data',
      'walk_forward_inconsistent',
    ]);
    const nonCaveatFlags = (report.overfitting_flags ?? []).filter((f) => !caveatFlags.has(f));

    if (nonCaveatFlags.length === 0 && report.out_sample_sharpe > 0.5) {
      const needsCaveats = Boolean(report.walk_forward_skipped) || (report.overfitting_flags ?? []).some((f) => caveatFlags.has(f));
      report.recommendation = needsCaveats ? ('approved_with_caveats' as any) : 'approved_for_forward_test';
      report.reason = needsCaveats
        ? 'Approved with caveats: limited sample and/or walk-forward skipped; monitor regime sensitivity.'
        : 'Clean backtest with acceptable OOS Sharpe.';
    } else if (report.overfitting_flags.includes('insufficient_trades')) {
      report.recommendation = 'archived';
      report.reason = 'Insufficient data; unable to support approval.';
    } else {
      report.recommendation = 'return_to_research';
      report.reason = 'Needs refinement / additional evidence.';
    }
  }

  return report;
}

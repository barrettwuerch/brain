// Strategy Bot computations (pure; no DB, no API)

import type { BacktestReport, ResearchFinding, StrategyFormalization } from '../../types';

export function formalizeStrategy(finding: ResearchFinding): StrategyFormalization {
  const market_scope = finding.market ?? 'general';

  return {
    finding_id: finding.id,
    entry_conditions: `Entry based on finding description + mechanism: ${finding.description} | ${finding.mechanism ?? ''}`.trim(),
    exit_conditions: `Exit when invalidation criteria hit OR time-based exit after N periods; include stop-loss/profit-target derived from failure conditions: ${finding.failure_conditions ?? ''}`.trim(),
    position_sizing_rule: 'Use Kelly criterion sizing with 0.25x fractional Kelly (conservative).',
    invalidation_criteria:
      'IS drops below 0.05 for 2 consecutive evaluations; ' +
      `plus finding-specific failure conditions: ${finding.failure_conditions ?? 'none specified'}`,
    market_scope,
    created_at: new Date().toISOString(),
    created_by: 'strategy-bot-1',
  };
}

export function detectOverfitting(
  report: Partial<BacktestReport>,
): { overfit: boolean; flags: string[]; recommendation: string } {
  const flags: string[] = [];

  if ((report.in_sample_sharpe ?? 0) > 2.0) flags.push('in_sample_sharpe_gt_2');

  const ins = report.in_sample_sharpe;
  const oos = report.out_sample_sharpe;
  if (typeof ins === 'number' && typeof oos === 'number' && Math.abs(ins) > 1e-9) {
    const div = Math.abs(oos - ins) / Math.abs(ins);
    if (div > 0.3) flags.push('oos_vs_is_divergence_gt_30pct');
  }

  const trades = (report.in_sample_trades ?? 0) + (report.out_sample_trades ?? 0);
  if (trades < 100) flags.push('trade_count_lt_100');

  const paramCount = (report as any).parameter_count;
  if (typeof paramCount === 'number' && paramCount > 5) flags.push('parameter_count_gt_5');

  const overfit = flags.length > 0;
  return { overfit, flags, recommendation: overfit ? 'archive' : 'proceed' };
}

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

export function computeWalkForwardWindows(
  outcomes: number[],
  windowSize: number = 20,
): { window_results: number[]; consistent: boolean; avg_sharpe: number } {
  const ws = Math.max(1, Math.floor(windowSize));
  const window_results: number[] = [];

  for (let i = 0; i < outcomes.length; i += ws) {
    const w = outcomes.slice(i, i + ws);
    if (!w.length) continue;
    window_results.push(mean(w));
  }

  const avg_sharpe = mean(window_results);
  const s = std(window_results);
  const consistent = window_results.every((w) => w >= 0.5) && s < 0.25;

  return { window_results, consistent, avg_sharpe };
}

// Inline smoke test
if (process.argv[1]?.endsWith('strategy_compute.ts')) {
  const finding: any = {
    id: 'f1',
    created_at: new Date().toISOString(),
    bot_id: 'research-bot-1',
    desk: 'prediction_markets',
    agent_role: 'research',
    finding_type: 'preliminary',
    edge_type: 'liquidity',
    description: 'Momentum continuation over last 5 points',
    mechanism: 'Liquidity + herding',
    failure_conditions: 'Regime shift',
    market: 'KXTEST',
    regime_notes: null,
    rqs_score: 0.5,
    rqs_components: null,
    sample_size: 50,
    observed_rate: 0.6,
    base_rate: 0.5,
    lift: 0.1,
    out_of_sample: false,
    status: 'under_investigation',
    recommendation: 'investigate_further',
    backtest_result: null,
    supporting_episode_ids: [],
    notes: null,
  };

  console.log('formalizeStrategy', formalizeStrategy(finding));

  console.log(
    'detectOverfitting',
    detectOverfitting({
      in_sample_sharpe: 2.2,
      out_sample_sharpe: 1.0,
      in_sample_trades: 40,
      out_sample_trades: 10,
      max_drawdown: 0.1,
      profit_factor: 1.2,
      slippage_assumed: 0.0015,
      overfitting_flags: [],
      regime_results: {},
      recommendation: 'return_to_research',
      reason: 'test',
    }),
  );

  console.log(
    'computeWalkForwardWindows',
    computeWalkForwardWindows(Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? 0 : 1)), 20),
  );
}

import 'dotenv/config';

import type { StrategyOutcome, StrategyOutcomeStatus } from '../types';

import { supabaseAdmin } from '../lib/supabase';
import { updateFindingStatus } from './research_findings';

function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function getStrategyOutcome(strategyId: string): Promise<StrategyOutcome | null> {
  const { data, error } = await supabaseAdmin
    .from('strategy_outcomes')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as any) ?? null;
}

export async function getOutcomesByStatus(status: StrategyOutcomeStatus): Promise<StrategyOutcome[]> {
  const { data, error } = await supabaseAdmin
    .from('strategy_outcomes')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as any;
}

export async function evaluateAgainstBacktest(
  strategyId: string,
  backtestWinRate: number,
  backtestPnl: number,
): Promise<void> {
  const out = await getStrategyOutcome(strategyId);
  if (!out) return;

  const win = out.win_rate;
  const pnl = safeNum(out.total_pnl);

  const win_rate_divergence = win === null ? 1 : Math.abs(Number(win) - Number(backtestWinRate)) / Math.max(Number(backtestWinRate), 0.001);
  const pnl_divergence = Math.abs(pnl - Number(backtestPnl)) / Math.max(Math.abs(Number(backtestPnl)), 0.001);
  const divergence_pct = Math.max(win_rate_divergence, pnl_divergence);
  const matches_backtest = divergence_pct <= 0.3;

  let status: StrategyOutcomeStatus = out.status;
  if (out.total_trades >= 30) status = matches_backtest ? 'approved' : 'underperforming';

  const { error } = await supabaseAdmin
    .from('strategy_outcomes')
    .update({
      divergence_pct,
      matches_backtest,
      evaluated_at: new Date().toISOString(),
      backtest_win_rate: backtestWinRate,
      backtest_pnl: backtestPnl,
      status,
    })
    .eq('id', out.id);

  if (error) throw error;
}

async function latestBacktestMetrics(strategyId: string): Promise<{ backtestWinRate: number; backtestPnl: number } | null> {
  // Pull the most recent APPROVED backtest episode for this strategyId.
  // Episode structure may store the BacktestReport in either observation.actual or action_taken.report.

  const q1 = await supabaseAdmin
    .from('episodes')
    .select('observation,created_at,task_type')
    .in('task_type', ['run_backtest', 'run_crypto_backtest'])
    .filter('observation->actual->>finding_id', 'eq', strategyId)
    .filter('observation->actual->>recommendation', 'eq', 'approved_for_forward_test')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (q1.error) throw q1.error;
  let data: any = q1.data;

  if (!data) {
    const q2 = await supabaseAdmin
      .from('episodes')
      .select('action_taken,created_at,task_type')
      .in('task_type', ['run_backtest', 'run_crypto_backtest'])
      .filter('action_taken->report->>finding_id', 'eq', strategyId)
      .filter('action_taken->report->>recommendation', 'eq', 'approved_for_forward_test')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (q2.error) throw q2.error;
    data = q2.data as any;

    if (!data) return null;

    const rep: any = (data as any).action_taken?.report;
    const backtestWinRate = safeNum(rep?.win_rate);
    const backtestPnl = safeNum(rep?.total_pnl);
    return { backtestWinRate, backtestPnl };
  }

  const rep: any = (data as any).observation?.actual;
  const backtestWinRate = safeNum(rep?.win_rate);
  const backtestPnl = safeNum(rep?.total_pnl);

  return { backtestWinRate, backtestPnl };
}

export async function checkAndUpdateFindingStatus(strategyId: string): Promise<void> {
  const out = await getStrategyOutcome(strategyId);
  if (!out) return;

  if (out.status === 'approved') {
    await updateFindingStatus(strategyId, 'approved_for_live');
    console.log(`[FEEDBACK] Strategy ${strategyId} approved for live trading — matches backtest within 30%`);
    return;
  }

  if (out.status === 'underperforming') {
    await updateFindingStatus(strategyId, 'under_investigation');
    console.log(`[FEEDBACK] Strategy ${strategyId} returned to investigation — diverges from backtest`);

    // Improvement 4: seed next-generation hypothesis task.
    try {
      const { data: finding } = await supabaseAdmin.from('research_findings').select('id,market_type').eq('id', strategyId).maybeSingle();
      const market_type = String((finding as any)?.market_type ?? 'prediction') as any;
      const { seedNextGenHypothesisTask } = await import('../adapters/kalshi/research_tasks');
      const task = seedNextGenHypothesisTask(strategyId, market_type === 'crypto' ? 'crypto' : 'prediction');

      const { error } = await supabaseAdmin.from('tasks').insert({
        task_type: task.task_type,
        task_input: task.task_input,
        status: 'queued',
        tags: ['research', 'next_gen'],
        agent_role: task.agent_role,
        desk: task.desk,
        bot_id: task.bot_id,
      });
      if (!error) console.log(`[FEEDBACK] Seeded next-gen hypothesis task for failed strategy ${strategyId}`);
    } catch {}

    return;
  }

  if (out.status === 'sufficient') {
    const m = await latestBacktestMetrics(strategyId);
    if (!m) {
      console.warn(`[FEEDBACK] No approved backtest found for strategy ${strategyId} — skipping divergence comparison`);
      return;
    }

    await evaluateAgainstBacktest(strategyId, m.backtestWinRate, m.backtestPnl);
    // re-check once after evaluation
    const refreshed = await getStrategyOutcome(strategyId);
    if (refreshed?.status === 'approved' || refreshed?.status === 'underperforming') {
      await checkAndUpdateFindingStatus(strategyId);
    }
  }
}

export async function reconcileSufficientOutcomes(limit: number = 25): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('strategy_outcomes')
    .select('strategy_id,status,evaluated_at,total_trades')
    .eq('status', 'sufficient')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  for (const r of data ?? []) {
    const row: any = r;
    const id = String(row.strategy_id);
    await checkAndUpdateFindingStatus(id);
  }
}

async function latestChallengeFailureProbability(strategyId: string): Promise<number | null> {
  // Pull the most recent challenge episode for this strategy.
  // NOTE: use a small window + in-memory match to avoid brittle JSONB filter syntax.
  const { data, error } = await supabaseAdmin
    .from('episodes')
    .select('action_taken,task_input,created_at,task_type')
    .in('task_type', ['challenge_strategy', 'challenge_crypto_strategy'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  const ep = (data ?? []).find((e: any) => {
    const fid = e?.task_input?.finding_id ?? e?.task_input?.formalization?.finding_id ?? e?.action_taken?.challenge?.finding_id;
    return String(fid) === String(strategyId);
  });

  const p = Number((ep as any)?.action_taken?.challenge?.failure_probability);
  return Number.isFinite(p) ? p : null;
}

async function updateChallengeCalibrationScore(params: {
  strategyId: string;
  desk: string;
  regime: string;
  total_trades: number;
  losing_trades: number;
}): Promise<void> {
  // Brier score: (p_fail - y_fail)^2
  // p_fail is the challenge's predicted failure probability.
  // y_fail is observed failure frequency (losing_trades / total_trades).

  const { strategyId, desk, regime } = params;

  // Only compute calibration when we have at least 10 strategy outcomes for that desk/regime combination.
  const { count, error: cErr } = await supabaseAdmin
    .from('strategy_outcomes')
    .select('id', { count: 'exact', head: true })
    .eq('desk', desk)
    .eq('dominant_regime', regime);
  if (cErr) throw cErr;

  if (Number(count ?? 0) < 10) {
    const { error } = await supabaseAdmin
      .from('strategy_outcomes')
      .update({ challenge_calibration_score: null })
      .eq('strategy_id', strategyId);
    if (error) throw error;
    console.log(`[CALIBRATION] insufficient data: desk=${desk} regime=${regime} outcomes=${count ?? 0} (<10) — wrote null`);
    return;
  }

  const p = await latestChallengeFailureProbability(strategyId);
  if (p === null) {
    const { error } = await supabaseAdmin
      .from('strategy_outcomes')
      .update({ challenge_calibration_score: null })
      .eq('strategy_id', strategyId);
    if (error) throw error;
    console.log(`[CALIBRATION] missing challenge failure_probability for strategy=${strategyId} — wrote null`);
    return;
  }

  const y = params.total_trades > 0 ? params.losing_trades / params.total_trades : 0;
  const brier = Math.pow(p - y, 2);

  const { error } = await supabaseAdmin
    .from('strategy_outcomes')
    .update({ challenge_calibration_score: brier })
    .eq('strategy_id', strategyId);
  if (error) throw error;
}

export async function upsertStrategyOutcome(
  strategyId: string,
  trade: { pnl: number; won: boolean; regime?: string; market_type: 'prediction' | 'crypto' | 'equity' | 'options'; desk: string; watch_condition_id?: string | null },
): Promise<void> {
  const existing = await getStrategyOutcome(strategyId);

  const nowIso = new Date().toISOString();

  if (!existing) {
    const regime = trade.regime ?? 'unknown';
    const breakdown = { [regime]: 1 };

    const { error } = await supabaseAdmin.from('strategy_outcomes').insert({
      strategy_id: strategyId,
      market_type: trade.market_type,
      desk: trade.desk,
      total_trades: 1,
      winning_trades: trade.won ? 1 : 0,
      losing_trades: trade.won ? 0 : 1,
      win_rate: trade.won ? 1 : 0,
      avg_win: trade.won ? trade.pnl : null,
      avg_loss: trade.won ? null : trade.pnl,
      profit_factor: null,
      total_pnl: trade.pnl,
      max_drawdown: null,
      regime_breakdown: breakdown,
      dominant_regime: regime,
      status: 'accumulating',
      watch_condition_id: trade.watch_condition_id ?? null,
      last_trade_at: nowIso,
    });
    if (error) throw error;

    // FIX 5: compute and persist challenge calibration score (Brier), if enough data.
    try {
      await updateChallengeCalibrationScore({
        strategyId,
        desk: trade.desk,
        regime,
        total_trades: 1,
        losing_trades: trade.won ? 0 : 1,
      });
    } catch (e: any) {
      console.warn('[CALIBRATION] update failed (insert):', e?.message ?? e);
    }

    await checkAndUpdateFindingStatus(strategyId);
    return;
  }

  const total_trades = safeNum(existing.total_trades) + 1;
  const winning_trades = safeNum(existing.winning_trades) + (trade.won ? 1 : 0);
  const losing_trades = safeNum(existing.losing_trades) + (trade.won ? 0 : 1);

  const total_pnl = safeNum(existing.total_pnl) + safeNum(trade.pnl);

  // avg win/loss updates (running mean)
  const prevAvgWin = existing.avg_win;
  const prevAvgLoss = existing.avg_loss;
  const prevWins = safeNum(existing.winning_trades);
  const prevLosses = safeNum(existing.losing_trades);

  const avg_win = trade.won
    ? (prevAvgWin === null ? trade.pnl : (prevAvgWin * prevWins + trade.pnl) / Math.max(prevWins + 1, 1))
    : prevAvgWin;

  const avg_loss = !trade.won
    ? (prevAvgLoss === null ? trade.pnl : (prevAvgLoss * prevLosses + trade.pnl) / Math.max(prevLosses + 1, 1))
    : prevAvgLoss;

  // profit factor proxy: gross wins / abs(gross losses)
  const grossWin = safeNum(avg_win) * safeNum(winning_trades);
  const grossLossAbs = Math.abs(safeNum(avg_loss) * safeNum(losing_trades));
  const profit_factor = grossLossAbs > 0 ? grossWin / grossLossAbs : null;

  const win_rate = total_trades > 0 ? winning_trades / total_trades : null;

  // regime breakdown
  const regime = trade.regime ?? 'unknown';
  const breakdown: Record<string, number> = (existing.regime_breakdown as any) ?? {};
  breakdown[regime] = safeNum(breakdown[regime]) + 1;
  const dominant_regime = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  let status: StrategyOutcomeStatus = existing.status;
  if (total_trades >= 30 && existing.status === 'accumulating') status = 'sufficient';

  const { error } = await supabaseAdmin
    .from('strategy_outcomes')
    .update({
      total_trades,
      winning_trades,
      losing_trades,
      win_rate,
      avg_win,
      avg_loss,
      profit_factor,
      total_pnl,
      regime_breakdown: breakdown,
      dominant_regime,
      last_trade_at: nowIso,
      status,
    })
    .eq('id', existing.id);

  if (error) throw error;

  // FIX 5: compute and persist challenge calibration score (Brier), if enough data.
  try {
    await updateChallengeCalibrationScore({
      strategyId,
      desk: trade.desk,
      regime,
      total_trades,
      losing_trades,
    });
  } catch (e: any) {
    console.warn('[CALIBRATION] update failed (update):', e?.message ?? e);
  }

  await checkAndUpdateFindingStatus(strategyId);
}

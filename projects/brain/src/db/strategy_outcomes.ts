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
  // Pull the most recent backtest episode where report.finding_id == strategyId.
  const { data, error } = await supabaseAdmin
    .from('episodes')
    .select('observation,created_at,task_type')
    .in('task_type', ['run_backtest', 'run_crypto_backtest'])
    // Compare against the most recent APPROVED backtest, not just the most recent run.
    .filter('observation->actual->>finding_id', 'eq', strategyId)
    .filter('observation->actual->>recommendation', 'eq', 'approved_for_forward_test')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const rep: any = (data as any).observation?.actual;
  const backtestWinRate = safeNum(rep?.win_rate);
  const backtestPnl = safeNum(rep?.total_pnl);

  if (!Number.isFinite(backtestWinRate) && !Number.isFinite(backtestPnl)) return null;
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
    return;
  }

  if (out.status === 'sufficient') {
    const m = await latestBacktestMetrics(strategyId);
    if (!m) return;

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

  await checkAndUpdateFindingStatus(strategyId);
}

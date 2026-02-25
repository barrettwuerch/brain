import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { spearman } from '../../evaluation/calibration';
import { evaluateCautiousTransition, transitionState } from '../../behavioral/state_manager';

export async function attributePerformance(): Promise<{ byBot: Record<string, string>; highlights: string[]; warnings: string[]; strategyHighlights: string[]; strategyWarnings: string[]; strategySummary: { approved: number; accumulating: number; underperforming: number; sufficientNotEvaluated: number } }> {
  const { data: bots, error: botsErr } = await supabaseAdmin.from('bot_states').select('*');
  if (botsErr) throw botsErr;

  const byBot: Record<string, string> = {};
  const highlights: string[] = [];
  const warnings: string[] = [];

  const strategyHighlights: string[] = [];
  const strategyWarnings: string[] = [];
  const strategySummary = { approved: 0, accumulating: 0, underperforming: 0, sufficientNotEvaluated: 0 };

  for (const b of bots ?? []) {
    const bot_id = String((b as any).bot_id);

    // Latest IS (table is task_type keyed; if no bot_id linkage, take latest overall)
    const { data: isRow } = await supabaseAdmin
      .from('intelligence_scores')
      .select('value,created_at')
      .eq('metric', 'intelligence_score')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const isValue = isRow ? Number((isRow as any).value ?? 0) : null;

    let classification = 'insufficient_data';
    if (typeof isValue === 'number') {
      if (isValue > 0.15) classification = 'improving';
      else if (isValue < -0.1) classification = 'degrading';
      else classification = 'stable';
    }

    byBot[bot_id] = `IS=${isValue ?? 'n/a'} (${classification})`;

    if (typeof isValue === 'number' && isValue > 0.15) highlights.push(bot_id);

    if (typeof isValue === 'number' && isValue < -0.1) warnings.push(`${bot_id}: IS below -0.10`);

    const state = String((b as any).current_state);
    if (state === 'paused' || state === 'diagnostic') warnings.push(`${bot_id}: state=${state}`);

    if (state === 'cautious') {
      // Note: intelligence_scores is not bot-keyed yet; use latest overall 3 scores as a proxy.
      const { data: rows } = await supabaseAdmin
        .from('intelligence_scores')
        .select('value,created_at')
        .eq('metric', 'intelligence_score')
        .order('created_at', { ascending: false })
        .limit(3);

      const scores = (rows ?? []).map((r: any) => Number(r.value ?? 0));
      const decision = evaluateCautiousTransition(bot_id, scores);
      if (decision !== 'stay') {
        await transitionState(bot_id, decision as any, 'intelligence_cautious_evaluation');
        if (decision === 'exploiting') highlights.push(`${bot_id} recovered from CAUTIOUS`);
        if (decision === 'paused') warnings.push(`${bot_id} escalated CAUTIOUS → PAUSED`);
      }
    }

    const warm = Boolean((b as any).warm_up);
    const rem = Number((b as any).warm_up_episodes_remaining ?? 0);
    if (warm && rem < 5) warnings.push(`${bot_id}: warm_up nearly done (${rem} remaining) but IS may still be insufficient`);
  }

  // Strategy outcomes
  try {
    const { data: outs } = await supabaseAdmin
      .from('strategy_outcomes')
      .select('strategy_id,total_trades,win_rate,status,matches_backtest,divergence_pct')
      .in('status', ['sufficient', 'approved', 'underperforming', 'accumulating']);

    for (const o of outs ?? []) {
      const row: any = o;
      const id = String(row.strategy_id);
      const status = String(row.status);

      if (status === 'approved') {
        strategySummary.approved += 1;
        strategyHighlights.push(`Strategy ${id} approved — ${row.total_trades} trades, win_rate=${row.win_rate ?? 'n/a'}, matches backtest`);
      } else if (status === 'underperforming') {
        strategySummary.underperforming += 1;
        strategyWarnings.push(`Strategy ${id} underperforming — divergence=${row.divergence_pct ?? 'n/a'}`);
      } else if (status === 'sufficient') {
        strategySummary.sufficientNotEvaluated += 1;
        strategyWarnings.push(`Strategy ${id} ready for backtest comparison (30+ trades)`);
      } else {
        strategySummary.accumulating += 1;
      }
    }
  } catch {}

  return { byBot, highlights, warnings, strategyHighlights, strategyWarnings, strategySummary };
}

export async function computeLearningVelocity(): Promise<{
  strategyApprovalRate: number | null;
  falsePositiveRate: number | null;
  avgDiscoveryCycleDays: number | null;
  window_days: number;
  note: string;
}> {
  const window_days = 90;
  const cutoff = new Date(Date.now() - window_days * 24 * 60 * 60 * 1000).toISOString();

  // strategyApprovalRate
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from('strategy_outcomes')
    .select('status,evaluated_at,strategy_id')
    .gte('evaluated_at', cutoff)
    .in('status', ['approved', 'underperforming']);
  if (evalErr) throw evalErr;

  const denom1 = (evals ?? []).length;
  const num1 = (evals ?? []).filter((r: any) => String(r.status) === 'approved').length;
  const strategyApprovalRate = denom1 >= 3 ? num1 / denom1 : null;

  // falsePositiveRate
  const under = (evals ?? []).filter((r: any) => String(r.status) === 'underperforming').length;
  const denom2 = denom1;
  const falsePositiveRate = denom2 >= 3 ? under / denom2 : null;

  // avgDiscoveryCycleDays
  // We do not have research_findings.updated_at in schema; use evaluated_at of the approved outcome as the end timestamp.
  const { data: approved, error: apErr } = await supabaseAdmin
    .from('strategy_outcomes')
    .select('strategy_id,evaluated_at')
    .gte('evaluated_at', cutoff)
    .eq('status', 'approved');
  if (apErr) throw apErr;

  let avgDiscoveryCycleDays: number | null = null;
  if ((approved ?? []).length >= 2) {
    const ids = (approved ?? []).map((r: any) => String(r.strategy_id));
    const { data: findings, error: fErr } = await supabaseAdmin
      .from('research_findings')
      .select('id,created_at')
      .in('id', ids);
    if (fErr) throw fErr;

    const createdById = new Map<string, string>();
    for (const f of findings ?? []) createdById.set(String((f as any).id), String((f as any).created_at));

    const days: number[] = [];
    for (const r of approved ?? []) {
      const id = String((r as any).strategy_id);
      const created = createdById.get(id);
      const end = String((r as any).evaluated_at ?? '');
      if (!created || !end) continue;
      const ms = new Date(end).getTime() - new Date(created).getTime();
      if (Number.isFinite(ms) && ms >= 0) days.push(ms / (24 * 60 * 60 * 1000));
    }

    if (days.length >= 2) avgDiscoveryCycleDays = days.reduce((a, b) => a + b, 0) / days.length;
  }

  const note =
    strategyApprovalRate === null && falsePositiveRate === null && avgDiscoveryCycleDays === null
      ? 'Insufficient data for velocity metrics — check back after 30+ strategy evaluations'
      : 'Rolling 90-day window';

  return { strategyApprovalRate, falsePositiveRate, avgDiscoveryCycleDays, window_days, note };
}

export async function detectCalibrationWarnings(): Promise<string[]> {
  const { data: eps, error } = await supabaseAdmin
    .from('episodes')
    .select('bot_id,reasoning_score,outcome_score,created_at')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;

  const byBot = new Map<string, any[]>();
  for (const e of eps ?? []) {
    const bot = String((e as any).bot_id ?? 'default');
    const arr = byBot.get(bot) ?? [];
    arr.push(e);
    byBot.set(bot, arr);
  }

  const warnings: string[] = [];

  for (const [bot, rows] of byBot.entries()) {
    if (rows.length < 20) continue;
    const last20 = rows.slice(0, 20);
    const rs = last20.map((r: any) => Number(r.reasoning_score ?? 0));
    const os = last20.map((r: any) => Number(r.outcome_score ?? 0));
    const rho = spearman(rs, os);
    if (rho < 0.3) warnings.push(`${bot}: calibration below threshold (${rho.toFixed(3)})`);
  }

  return warnings;
}

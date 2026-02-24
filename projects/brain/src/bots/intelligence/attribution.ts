import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { spearman } from '../../evaluation/calibration';

export async function attributePerformance(windowDays: number = 7): Promise<{
  by_bot: Record<
    string,
    {
      is_trend: 'improving' | 'stable' | 'degrading' | 'insufficient';
      latest_is: number | null;
      calibration_warning: boolean;
      lucky_warning: boolean;
    }
  >;
  highlights: string[];
  warnings: string[];
}> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: eps, error: epsErr } = await supabaseAdmin
    .from('episodes')
    .select('bot_id,task_type,created_at,outcome_score,reasoning_score')
    .gte('created_at', since);
  if (epsErr) throw epsErr;

  const botIds = Array.from(new Set((eps ?? []).map((r: any) => String(r.bot_id ?? 'default')))).sort();

  const by_bot: any = {};
  const highlights: string[] = [];
  const warnings: string[] = [];

  for (const bot_id of botIds) {
    const botEpisodes = (eps ?? []).filter((r: any) => String(r.bot_id ?? 'default') === bot_id);
    const botTaskTypes = Array.from(new Set(botEpisodes.map((r: any) => String(r.task_type))));

    // Fetch last 10 IS scores for these task_types (intelligence_scores table is task_type keyed today)
    const { data: isRows, error: isErr } = await supabaseAdmin
      .from('intelligence_scores')
      .select('value,created_at,task_type')
      .eq('metric', 'intelligence_score')
      .in('task_type', botTaskTypes.length ? botTaskTypes : ['__none__'])
      .order('created_at', { ascending: false })
      .limit(10);
    if (isErr) throw isErr;

    const isVals = (isRows ?? []).map((r: any) => Number(r.value ?? 0));

    let is_trend: 'improving' | 'stable' | 'degrading' | 'insufficient' = 'insufficient';
    let latest_is: number | null = isVals.length ? isVals[0] : null;

    if (isVals.length >= 6) {
      const first3 = isVals.slice(-3);
      const last3 = isVals.slice(0, 3);
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
      const delta = avg(last3) - avg(first3);
      if (delta > 0.05) is_trend = 'improving';
      else if (delta < -0.05) is_trend = 'degrading';
      else is_trend = 'stable';
    }

    // Calibration warning: Spearman(reasoning_score, outcome_score) < 0.3 on last 20 eps
    const last20 = botEpisodes
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);
    const rs = last20.map((r: any) => Number(r.reasoning_score ?? 0));
    const os = last20.map((r: any) => Number(r.outcome_score ?? 0));
    const rho = rs.length >= 2 ? spearman(rs, os) : 0;
    const calibration_warning = last20.length >= 10 && rho < 0.3;

    // Lucky warning: outcome high but reasoning low
    const last10 = botEpisodes
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
    const avgOs = avg(last10.map((r: any) => Number(r.outcome_score ?? 0)));
    const avgRs = avg(last10.map((r: any) => Number(r.reasoning_score ?? 0)));
    const lucky_warning = last10.length >= 10 && avgOs > 0.8 && avgRs < 0.5;

    by_bot[bot_id] = { is_trend, latest_is, calibration_warning, lucky_warning };

    if (is_trend === 'improving') highlights.push(bot_id);
    if (is_trend === 'degrading' || calibration_warning || lucky_warning) {
      const reasons = [
        is_trend === 'degrading' ? 'IS degrading' : null,
        calibration_warning ? 'calibration warning' : null,
        lucky_warning ? 'lucky warning' : null,
      ].filter(Boolean);
      warnings.push(`${bot_id}: ${reasons.join(', ')}`);
    }
  }

  return { by_bot, highlights, warnings };
}

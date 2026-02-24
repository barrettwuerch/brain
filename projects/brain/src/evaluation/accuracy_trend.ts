import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

export type TrendClass = 'improving' | 'stable' | 'degrading' | 'volatile' | 'insufficient_data';

export interface AccuracyTrendResult {
  task_type: string;
  windowSize: number;
  episode_count: number;
  recent_accuracy: number;
  prior_accuracy: number;
  trend_delta: number;
  trend_class: TrendClass;
  volatility: number;
  episode_ids: string[];
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

export async function computeAccuracyTrend(task_type: string, windowSize: number = 20): Promise<AccuracyTrendResult> {
  const { data, error } = await supabaseAdmin
    .from('episodes')
    .select('id,outcome_score,created_at')
    .eq('task_type', task_type)
    .order('created_at', { ascending: false })
    .limit(windowSize);

  if (error) throw error;

  const rows = (data ?? []) as any[];
  const scores = rows.map((r) => Number(r.outcome_score ?? 0));
  const episode_ids = rows.map((r) => String(r.id));

  if (rows.length < 10) {
    return {
      task_type,
      windowSize,
      episode_count: rows.length,
      recent_accuracy: mean(scores.slice(0, 10)),
      prior_accuracy: mean(scores.slice(10, 20)),
      trend_delta: 0,
      trend_class: 'insufficient_data',
      volatility: stddev(scores),
      episode_ids,
    };
  }

  const recent = scores.slice(0, 10);
  const prior = scores.slice(10, 20);

  const recent_accuracy = mean(recent);
  const prior_accuracy = prior.length ? mean(prior) : mean(scores);
  const trend_delta = recent_accuracy - prior_accuracy;

  const volatility = stddev(scores);

  let trend_class: TrendClass = 'stable';
  if (volatility > 0.3) trend_class = 'volatile';
  else if (trend_delta > 0.05 && volatility < 0.15) trend_class = 'improving';
  else if (trend_delta < -0.05) trend_class = 'degrading';

  return {
    task_type,
    windowSize,
    episode_count: rows.length,
    recent_accuracy,
    prior_accuracy,
    trend_delta,
    trend_class,
    volatility,
    episode_ids,
  };
}

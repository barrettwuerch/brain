import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

export type CalibrationInterpretation = 'well_calibrated' | 'overconfident' | 'underconfident' | 'uncorrelated' | 'insufficient_data';

export interface CalibrationResult {
  task_type: string;
  windowSize: number;
  episode_count: number;
  calibration_score: number; // Spearman rho (-1..1)
  interpretation: CalibrationInterpretation;
  episode_ids: string[];
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function rank(values: number[]): number[] {
  // Average ranks for ties.
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array(values.length).fill(0);

  let pos = 0;
  while (pos < indexed.length) {
    let end = pos;
    while (end + 1 < indexed.length && indexed[end + 1].v === indexed[pos].v) end++;

    const avgRank = (pos + 1 + (end + 1)) / 2; // ranks are 1-based
    for (let j = pos; j <= end; j++) {
      ranks[indexed[j].i] = avgRank;
    }

    pos = end + 1;
  }

  return ranks;
}

export function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const rx = rank(x);
  const ry = rank(y);
  return pearson(rx, ry);
}

export async function computeCalibration(task_type: string, windowSize: number = 20): Promise<CalibrationResult> {
  const { data, error } = await supabaseAdmin
    .from('episodes')
    .select('id,reasoning_score,outcome_score,created_at')
    .eq('task_type', task_type)
    .order('created_at', { ascending: false })
    .limit(windowSize);

  if (error) throw error;

  const rows = (data ?? []) as any[];
  const rs = rows.map((r) => Number(r.reasoning_score ?? 0));
  const os = rows.map((r) => Number(r.outcome_score ?? 0));
  const episode_ids = rows.map((r) => String(r.id));

  if (rows.length < 10) {
    return {
      task_type,
      windowSize,
      episode_count: rows.length,
      calibration_score: 0,
      interpretation: 'insufficient_data',
      episode_ids,
    };
  }

  const calibration_score = spearman(rs, os);

  let interpretation: CalibrationInterpretation;
  if (calibration_score > 0.6) interpretation = 'well_calibrated';
  else if (calibration_score < -0.2) interpretation = 'overconfident';
  else if (Math.abs(calibration_score) < 0.2) interpretation = 'uncorrelated';
  else interpretation = 'underconfident';

  return {
    task_type,
    windowSize,
    episode_count: rows.length,
    calibration_score,
    interpretation,
    episode_ids,
  };
}

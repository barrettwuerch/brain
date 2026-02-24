import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { computeAccuracyTrend } from './accuracy_trend';
import { computeCalibration } from './calibration';

export type ISClass = 'learning' | 'stable' | 'regressing' | 'insufficient_data';

export interface IntelligenceScoreComputation {
  task_type: string;
  is_value: number; // -1..1
  classification: ISClass;
  accuracy_trend_delta: number;
  accuracy_trend_class: string;
  calibration_score: number;
  calibration_interpretation: string;
  transfer_score: number;
  episode_count: number;
  supporting_episode_ids: string[];
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export async function computeIntelligenceScore(task_type: string): Promise<IntelligenceScoreComputation> {
  const accuracy = await computeAccuracyTrend(task_type, 20);
  const calibration = await computeCalibration(task_type, 20);

  if (accuracy.trend_class === 'insufficient_data' || calibration.interpretation === 'insufficient_data') {
    return {
      task_type,
      is_value: 0,
      classification: 'insufficient_data',
      accuracy_trend_delta: accuracy.trend_delta,
      accuracy_trend_class: accuracy.trend_class,
      calibration_score: calibration.calibration_score,
      calibration_interpretation: calibration.interpretation,
      transfer_score: 0,
      episode_count: Math.min(accuracy.episode_count, calibration.episode_count),
      supporting_episode_ids: Array.from(new Set([...(accuracy.episode_ids ?? []), ...(calibration.episode_ids ?? [])])),
    };
  }

  const transfer_score = 0;
  const is_value = clamp(
    0.40 * accuracy.trend_delta + 0.35 * calibration.calibration_score + 0.25 * transfer_score,
    -1.0,
    1.0,
  );

  let classification: ISClass = 'stable';
  if (is_value > 0.15) classification = 'learning';
  else if (is_value < -0.10) classification = 'regressing';

  return {
    task_type,
    is_value,
    classification,
    accuracy_trend_delta: accuracy.trend_delta,
    accuracy_trend_class: accuracy.trend_class,
    calibration_score: calibration.calibration_score,
    calibration_interpretation: calibration.interpretation,
    transfer_score,
    episode_count: Math.min(accuracy.episode_count, calibration.episode_count),
    supporting_episode_ids: Array.from(new Set([...(accuracy.episode_ids ?? []), ...(calibration.episode_ids ?? [])])),
  };
}

export async function writeIntelligenceScore(task_type: string) {
  const computed = await computeIntelligenceScore(task_type);

  // Write one row to intelligence_scores
  const notes = JSON.stringify(
    {
      task_type: computed.task_type,
      classification: computed.classification,
      accuracy_trend_delta: computed.accuracy_trend_delta,
      accuracy_trend_class: computed.accuracy_trend_class,
      calibration_score: computed.calibration_score,
      calibration_interpretation: computed.calibration_interpretation,
      transfer_score: computed.transfer_score,
      episode_count: computed.episode_count,
    },
    null,
    0,
  );

  const { data, error } = await supabaseAdmin
    .from('intelligence_scores')
    .insert({
      metric: 'intelligence_score',
      task_type,
      value: computed.is_value,
      notes,
      supporting_episode_ids: computed.supporting_episode_ids,
    })
    .select('*')
    .single();

  if (error) throw error;
  return { computed, record: data };
}

async function main() {
  const task_type = process.argv[2];
  if (!task_type) {
    console.error('Usage: tsx src/evaluation/intelligence_score.ts <task_type>');
    process.exit(1);
  }

  const out = await writeIntelligenceScore(task_type);
  console.log('computed', out.computed);
  console.log('written', { id: (out.record as any)?.id, value: (out.record as any)?.value, created_at: (out.record as any)?.created_at });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

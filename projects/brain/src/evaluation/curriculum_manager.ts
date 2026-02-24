import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

export async function checkCurriculumPromotion(task_type: string): Promise<{ eligible: boolean; reason: string }> {
  const { data, error } = await supabaseAdmin
    .from('intelligence_scores')
    .select('value,notes,created_at')
    .eq('metric', 'intelligence_score')
    .eq('task_type', task_type)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;

  const rows = (data ?? []) as any[];
  if (rows.length < 5) return { eligible: false, reason: 'insufficient_data' };

  const parsed = rows.map((r) => {
    let notes: any = {};
    try {
      notes = r.notes ? JSON.parse(String(r.notes)) : {};
    } catch {
      notes = {};
    }
    return {
      is_value: Number(r.value ?? 0),
      trend_class: String(notes.accuracy_trend_class ?? ''),
    };
  });

  const allGood = parsed.every((r) => r.is_value > 0.15 && (r.trend_class === 'improving' || r.trend_class === 'stable'));
  if (allGood) return { eligible: true, reason: `PROMOTION ELIGIBLE: ${task_type} ready for next level` };

  const anyBad = parsed.some((r) => r.is_value < -0.1);
  if (anyBad) return { eligible: false, reason: `DEMOTION: ${task_type} struggling` };

  return { eligible: false, reason: 'not_eligible' };
}

async function main() {
  const task_type = process.argv[2];
  if (!task_type) {
    console.error('Usage: tsx src/evaluation/curriculum_manager.ts <task_type>');
    process.exit(1);
  }
  const out = await checkCurriculumPromotion(task_type);
  console.log(out.reason);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

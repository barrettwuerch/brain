import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { spearman } from '../../evaluation/calibration';

export async function attributePerformance(): Promise<{ byBot: Record<string, string>; highlights: string[]; warnings: string[] }> {
  const { data: bots, error: botsErr } = await supabaseAdmin.from('bot_states').select('*');
  if (botsErr) throw botsErr;

  const byBot: Record<string, string> = {};
  const highlights: string[] = [];
  const warnings: string[] = [];

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

    const warm = Boolean((b as any).warm_up);
    const rem = Number((b as any).warm_up_episodes_remaining ?? 0);
    if (warm && rem < 5) warnings.push(`${bot_id}: warm_up nearly done (${rem} remaining) but IS may still be insufficient`);
  }

  return { byBot, highlights, warnings };
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

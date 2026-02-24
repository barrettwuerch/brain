import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';

import { supabaseAdmin } from '../../lib/supabase';
import { generateDailyReport } from '../../evaluation/daily_report';
import { attributePerformance } from './attribution';
import { countPrunableEpisodes, extractAndStoreFacts } from './consolidation';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

export async function generateFullDailyReport(): Promise<string> {
  const now = new Date();
  const todayStart = startOfDayUtc(now);
  const date = isoDate(now);

  const base = await generateDailyReport();

  const attribution = await attributePerformance(7);

  const { data: todayEpisodes, error } = await supabaseAdmin
    .from('episodes')
    .select('*')
    .gte('created_at', todayStart.toISOString());
  if (error) throw error;

  const consolidation = await extractAndStoreFacts((todayEpisodes ?? []) as any, 'prediction_markets');
  const prunable = await countPrunableEpisodes();

  const { data: states } = await supabaseAdmin
    .from('bot_states')
    .select('bot_id,current_state,reason')
    .order('updated_at', { ascending: false });

  const nonExploiting = (states ?? []).filter((s: any) => String(s.current_state) !== 'exploiting');

  const lines: string[] = [];
  lines.push(`=== BRAIN — Full Daily Report [${date}] ===`);
  lines.push('');
  lines.push(base);

  lines.push('');
  lines.push('--- ATTRIBUTION ---');
  for (const [bot, r] of Object.entries(attribution.by_bot)) {
    lines.push(
      `- ${bot}: trend=${r.is_trend} latestIS=${r.latest_is ?? 'n/a'} calibWarn=${r.calibration_warning} luckyWarn=${r.lucky_warning}`,
    );
  }

  lines.push('');
  lines.push('--- CONSOLIDATION ---');
  lines.push(`Facts stored: ${consolidation.stored} | Updated: ${consolidation.updated} | Skipped: ${consolidation.skipped}`);
  lines.push(`Episodes eligible for pruning: ${prunable} (not pruned yet — run dev:prune)`);

  lines.push('');
  lines.push('--- NEEDS ATTENTION ---');
  if (attribution.warnings.length) {
    for (const w of attribution.warnings) lines.push(`- ${w}`);
  }
  if (nonExploiting.length) {
    for (const s of nonExploiting) lines.push(`- bot_state: ${s.bot_id} state=${s.current_state} reason=${s.reason ?? ''}`);
  }
  if (!attribution.warnings.length && !nonExploiting.length) lines.push('- (none)');

  const report = lines.join('\n');

  const outDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${date}-full.txt`);
  await fs.writeFile(outPath, report, 'utf8');

  console.log(report);
  console.log(`\nSaved full report: ${outPath}`);

  return report;
}

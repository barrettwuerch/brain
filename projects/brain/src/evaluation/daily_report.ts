import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';

import { supabaseAdmin } from '../lib/supabase';
import { writeIntelligenceScore } from './intelligence_score';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

function mostCommonThemes(lessons: string[], topN: number = 3): string[] {
  // Very simple theme extractor: normalize, count, then return top.
  const counts = new Map<string, number>();
  for (const l of lessons) {
    const s = String(l).trim();
    if (!s) continue;
    // normalize: lowercase + remove trailing punctuation
    const norm = s.toLowerCase().replace(/[\s]+/g, ' ').replace(/[.?!,:;]+$/g, '');
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k, v]) => `${k} (x${v})`);
}

export async function generateDailyReport(): Promise<string> {
  const now = new Date();
  const todayStart = startOfDayUtc(now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Episodes today
  const { count: todayCount, error: todayErr } = await supabaseAdmin
    .from('episodes')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString());
  if (todayErr) throw todayErr;

  // Distinct task types in last 7 days
  const { data: typesRows, error: typesErr } = await supabaseAdmin
    .from('episodes')
    .select('task_type')
    .gte('created_at', sevenDaysAgo.toISOString());
  if (typesErr) throw typesErr;

  const taskTypes = Array.from(new Set((typesRows ?? []).map((r: any) => String(r.task_type)))).sort();

  const results: any[] = [];
  for (const task_type of taskTypes) {
    const { computed } = await writeIntelligenceScore(task_type);
    results.push(computed);
  }

  const best = results
    .filter((r) => r.classification !== 'insufficient_data')
    .sort((a, b) => b.is_value - a.is_value)[0];

  const regressing = results.filter((r) => r.classification === 'regressing').map((r) => r.task_type);

  // Today's lessons
  const { data: lessonsRows, error: lessonsErr } = await supabaseAdmin
    .from('episodes')
    .select('lessons,reflection')
    .gte('created_at', todayStart.toISOString());
  if (lessonsErr) throw lessonsErr;

  const lessonStrings: string[] = [];
  for (const r of lessonsRows ?? []) {
    const arr = (r as any)?.lessons;
    if (Array.isArray(arr)) {
      for (const l of arr) lessonStrings.push(String(l));
    }
  }

  const topThemes = mostCommonThemes(lessonStrings, 3);

  const lines: string[] = [];
  lines.push(`BRAIN — Daily Report (${isoDate(now)})`);
  lines.push('');
  lines.push(`Total episodes run today: ${todayCount ?? 0}`);
  lines.push('');

  lines.push('Intelligence Score by task type:');
  for (const r of results) {
    lines.push(
      `- ${r.task_type}: IS=${r.is_value.toFixed(3)} (${r.classification}) | trend=${r.accuracy_trend_class} Δ=${r.accuracy_trend_delta.toFixed(3)} | calib=${r.calibration_score.toFixed(3)} (${r.calibration_interpretation})`,
    );
  }

  lines.push('');
  lines.push(`Best performing task type: ${best ? `${best.task_type} (IS=${best.is_value.toFixed(3)})` : '(insufficient_data)'}`);
  lines.push(`Regressing task types: ${regressing.length ? regressing.join(', ') : '(none)'}`);
  lines.push('');

  lines.push('Top 3 lesson themes (today):');
  if (topThemes.length) {
    for (const t of topThemes) lines.push(`- ${t}`);
  } else {
    lines.push('- (none)');
  }

  const report = lines.join('\n');

  const outDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${isoDate(now)}.txt`);
  await fs.writeFile(outPath, report, 'utf8');

  console.log(report);
  console.log(`\nSaved report: ${outPath}`);

  return report;
}

async function main() {
  await generateDailyReport();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

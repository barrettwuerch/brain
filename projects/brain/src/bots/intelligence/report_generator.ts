import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';

import { supabaseAdmin } from '../../lib/supabase';
import { attributePerformance, computeLearningVelocity, detectCalibrationWarnings } from './attribution';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

function topLessonThemes(lessons: string[], topN: number = 3): string[] {
  const counts = new Map<string, number>();
  for (const l of lessons) {
    const s = String(l ?? '').trim();
    if (!s) continue;
    if (s.startsWith('finding_id:')) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k, v]) => `${k} (x${v})`);
}

export async function generateFullDailyReport(): Promise<string> {
  const now = new Date();
  const date = isoDate(now);
  const todayStart = startOfDayUtc(now).toISOString();

  const { data: eps, error: epsErr, count } = await supabaseAdmin
    .from('episodes')
    .select('id,bot_id,lessons,created_at', { count: 'exact' })
    .gte('created_at', todayStart);
  if (epsErr) throw epsErr;

  const bots = Array.from(new Set((eps ?? []).map((e: any) => String(e.bot_id ?? 'default'))));

  const lessons: string[] = [];
  for (const e of eps ?? []) {
    const arr = (e as any).lessons;
    if (Array.isArray(arr)) for (const l of arr) lessons.push(String(l));
  }

  const top3 = topLessonThemes(lessons, 3);

  const { data: rf, error: rfErr } = await supabaseAdmin
    .from('research_findings')
    .select('id,rqs_score,created_at')
    .gte('created_at', todayStart);
  if (rfErr) throw rfErr;

  const rfCount = rf?.length ?? 0;
  const avgRqs = rfCount ? (rf ?? []).reduce((s: number, r: any) => s + Number(r.rqs_score ?? 0), 0) / rfCount : 0;

  const { data: cb, error: cbErr } = await supabaseAdmin
    .from('bot_state_transitions')
    .select('id,created_at,reason')
    .ilike('reason', 'circuit_breaker%')
    .gte('created_at', todayStart);
  if (cbErr) throw cbErr;

  const attribution = await attributePerformance();
  const velocity = await computeLearningVelocity();
  const calib = await detectCalibrationWarnings();

  const lines: string[] = [];
  lines.push(`BRAIN — Daily Report (${date})`);
  lines.push('');
  lines.push('ACTIVITY');
  lines.push(`Episodes today: ${count ?? 0} across ${bots.length} bots`);
  lines.push(`Research findings: ${rfCount} (avg RQS: ${avgRqs.toFixed(3)})`);
  lines.push(`Circuit breaker events: ${cb?.length ?? 0}`);
  lines.push('');

  lines.push('INTELLIGENCE SCORES');
  for (const [bot, desc] of Object.entries(attribution.byBot)) {
    // Trend arrows not implemented yet (needs bot-keyed IS history); show → placeholder.
    lines.push(`${bot}: ${desc} →`);
  }
  lines.push('');

  lines.push('CALIBRATION');
  if (calib.length) {
    for (const w of calib) lines.push(w);
  } else {
    lines.push('All bots well-calibrated');
  }
  lines.push('');

  lines.push('LESSONS');
  if (top3.length) for (const t of top3) lines.push(t);
  else lines.push('(none)');
  lines.push('');

  lines.push('STRATEGIES');
  lines.push(`Approved for live: ${attribution.strategySummary.approved}`);
  lines.push(`Accumulating data: ${attribution.strategySummary.accumulating}`);
  lines.push(`Underperforming: ${attribution.strategySummary.underperforming}`);
  lines.push(`Ready for backtest comparison: ${attribution.strategySummary.sufficientNotEvaluated}`);
  if (attribution.strategyHighlights.length) {
    lines.push('');
    for (const h of attribution.strategyHighlights) lines.push(h);
  }
  if (attribution.strategyWarnings.length) {
    lines.push('');
    for (const w of attribution.strategyWarnings) lines.push(w);
  }
  lines.push('');

  lines.push(`LEARNING VELOCITY (${velocity.window_days}-day rolling)`);
  lines.push('────────────────────────────────────────');
  lines.push(
    `Strategy approval rate: ${velocity.strategyApprovalRate === null ? 'null' : (velocity.strategyApprovalRate * 100).toFixed(1) + '%'} (target: >50%)`,
  );
  lines.push(
    `False positive rate: ${velocity.falsePositiveRate === null ? 'null' : (velocity.falsePositiveRate * 100).toFixed(1) + '%'} (target: <30%)`,
  );
  lines.push(
    `Avg discovery cycle: ${velocity.avgDiscoveryCycleDays === null ? 'null' : velocity.avgDiscoveryCycleDays.toFixed(1)} days (target: declining)`,
  );
  lines.push(velocity.note);
  lines.push('');
  lines.push('Interpretation:');
  lines.push('- All three improving → system is learning');
  lines.push('- Flat for 30+ days → investigate bottleneck');
  lines.push('- False positives rising → backtest quality issue');
  lines.push('');

  lines.push('NEEDS ATTENTION');
  if (attribution.warnings.length) {
    for (const w of attribution.warnings) lines.push(w);
  } else {
    lines.push('Nothing requires attention');
  }

  const report = lines.join('\n');

  const outDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${date}.txt`);
  await fs.writeFile(outPath, report, 'utf8');

  console.log(report);
  console.log(`Report saved: ${outPath}`);

  return report;
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateFullDailyReport().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

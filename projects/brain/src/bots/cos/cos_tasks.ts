// src/bots/cos/cos_tasks.ts
// Chief of Staff Bot — task seeders
//
// CoS tasks are scheduled differently from desk tasks:
// assess_strategic_priorities — weekly (Sunday, runs before weekly memo)
// generate_daily_brief — daily (6:45 AM CST, before 7am send)
// generate_weekly_memo — weekly (Sunday, 5:45 PM CST, before 6pm send)
// detect_systematic_blind_spots — monthly (first Sunday of month)
// generate_decision_packet — event-triggered (Orchestrator calls seedDecisionPacket)
// review_regime_strategy_alignment — weekly (Monday morning, after weekend regime check)
// evaluate_bottlenecks — event-triggered (Orchestrator calls seedBottleneckEval)

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────
export interface CosTaskInput_StrategicPriorities {
  window_days: 30;
  include_regime: true;
  include_is_trajectory: true;
  include_pipeline_health: true;
}

export interface CosTaskInput_DailyBrief {
  report_date: string; // YYYY-MM-DD
  target_email: string;
}

export interface CosTaskInput_WeeklyMemo {
  week_number: number;
  date_range_start: string; // YYYY-MM-DD
  date_range_end: string; // YYYY-MM-DD
  target_email: string;
}

export interface CosTaskInput_BlindSpots {
  lookback_days: 90;
  min_structural_risks: 3;
}

export interface CosTaskInput_DecisionPacket {
  topic: string;
  context: string; // 2 sentences max
  trigger_event: string; // what caused this escalation
  options?: string[]; // optional pre-populated options
  urgency_hint?: 'fyi' | 'eod' | 'before_market_open' | 'now';
}

export interface CosTaskInput_RegimeAlignment {
  current_regime: string;
  regime_age_days: number; // how long regime has been in this state
}

export interface CosTaskInput_BottleneckEval {
  trigger: 'cycle_time_increase' | 'approval_rate_drop' | 'repeated_circuit_breakers' | 'manual';
  window_days: 30;
  suspected_type?: 'capacity' | 'calibration' | 'unknown';
}

// ── Seeders ──────────────────────────────────────────────────────────────────
export async function seedStrategicPrioritiesTask(): Promise<void> {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'assess_strategic_priorities',
    task_input: {
      window_days: 30,
      include_regime: true,
      include_is_trajectory: true,
      include_pipeline_health: true,
    } satisfies CosTaskInput_StrategicPriorities,
    agent_role: 'chief_of_staff',
    bot_id: 'cos-bot-1',
    desk: 'all_desks',
    status: 'queued',
    tags: ['cos', 'weekly'],
  });
  if (error) throw new Error(`Failed to seed strategic priorities task: ${error.message}`);
  console.log('[CoS] Seeded: assess_strategic_priorities');
}

export async function seedDailyBriefTask(reportDate?: string): Promise<void> {
  const date = reportDate ?? new Date().toISOString().split('T')[0];
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'generate_daily_brief',
    task_input: {
      report_date: date,
      target_email: process.env.COS_EMAIL_TO ?? 'bear@bearkyler.com',
    } satisfies CosTaskInput_DailyBrief,
    agent_role: 'chief_of_staff',
    bot_id: 'cos-bot-1',
    desk: 'all_desks',
    status: 'queued',
    tags: ['cos', 'daily'],
  });
  if (error) throw new Error(`Failed to seed daily brief task: ${error.message}`);
  console.log(`[CoS] Seeded: generate_daily_brief for ${date}`);
}

export async function seedWeeklyMemoTask(): Promise<void> {
  const now = new Date();
  const weekNumber = getISOWeekNumber(now);
  const monday = getMondayOfWeek(now);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'generate_weekly_memo',
    task_input: {
      week_number: weekNumber,
      date_range_start: monday.toISOString().split('T')[0],
      date_range_end: sunday.toISOString().split('T')[0],
      target_email: process.env.COS_EMAIL_TO ?? 'bear@bearkyler.com',
    } satisfies CosTaskInput_WeeklyMemo,
    agent_role: 'chief_of_staff',
    bot_id: 'cos-bot-1',
    desk: 'all_desks',
    status: 'queued',
    tags: ['cos', 'weekly'],
  });
  if (error) throw new Error(`Failed to seed weekly memo task: ${error.message}`);
  console.log(`[CoS] Seeded: generate_weekly_memo for Week ${weekNumber}`);
}

export async function seedBlindSpotReviewTask(): Promise<void> {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'detect_systematic_blind_spots',
    task_input: {
      lookback_days: 90,
      min_structural_risks: 3,
    } satisfies CosTaskInput_BlindSpots,
    agent_role: 'chief_of_staff',
    bot_id: 'cos-bot-1',
    desk: 'all_desks',
    status: 'queued',
    tags: ['cos', 'monthly'],
  });
  if (error) throw new Error(`Failed to seed blind spot review task: ${error.message}`);
  console.log('[CoS] Seeded: detect_systematic_blind_spots');
}

export async function seedDecisionPacket(input: CosTaskInput_DecisionPacket): Promise<void> {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'generate_decision_packet',
    task_input: input,
    agent_role: 'chief_of_staff',
    bot_id: 'cos-bot-1',
    desk: 'all_desks',
    status: 'queued',
    tags: ['cos', 'event'],
  });
  if (error) throw new Error(`Failed to seed decision packet task: ${error.message}`);
  console.log(`[CoS] Seeded: generate_decision_packet — ${input.topic}`);
}

export async function seedRegimeAlignmentTask(currentRegime: string, regimeAgeDays: number): Promise<void> {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'review_regime_strategy_alignment',
    task_input: {
      current_regime: currentRegime,
      regime_age_days: regimeAgeDays,
    } satisfies CosTaskInput_RegimeAlignment,
    agent_role: 'chief_of_staff',
    bot_id: 'cos-bot-1',
    desk: 'all_desks',
    status: 'queued',
    tags: ['cos', 'weekly'],
  });
  if (error) throw new Error(`Failed to seed regime alignment task: ${error.message}`);
  console.log(`[CoS] Seeded: review_regime_strategy_alignment (regime=${currentRegime}, age=${regimeAgeDays}d)`);
}

export async function seedBottleneckEvalTask(
  trigger: CosTaskInput_BottleneckEval['trigger'],
  suspectedType?: CosTaskInput_BottleneckEval['suspected_type'],
): Promise<void> {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'evaluate_bottlenecks',
    task_input: {
      trigger,
      window_days: 30,
      suspected_type: suspectedType ?? 'unknown',
    } satisfies CosTaskInput_BottleneckEval,
    agent_role: 'chief_of_staff',
    bot_id: 'cos-bot-1',
    desk: 'all_desks',
    status: 'queued',
    tags: ['cos', 'event'],
  });
  if (error) throw new Error(`Failed to seed bottleneck eval task: ${error.message}`);
  console.log(`[CoS] Seeded: evaluate_bottlenecks (trigger=${trigger})`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

// ── CLI entry for manual seeding ──────────────────────────────────────────────
if (process.argv[1].endsWith('cos_tasks.ts')) {
  const arg = process.argv[2];
  (async () => {
    switch (arg) {
      case 'daily':
        await seedDailyBriefTask();
        break;
      case 'weekly':
        await seedWeeklyMemoTask();
        break;
      case 'priorities':
        await seedStrategicPrioritiesTask();
        break;
      case 'blind_spots':
        await seedBlindSpotReviewTask();
        break;
      case 'regime':
        await seedRegimeAlignmentTask(process.argv[3] ?? 'normal', parseInt(process.argv[4] ?? '1'));
        break;
      case 'bottleneck':
        await seedBottleneckEvalTask('manual');
        break;
      default:
        console.log('Usage: tsx src/bots/cos/cos_tasks.ts [daily|weekly|priorities|blind_spots|regime|bottleneck]');
    }
    process.exit(0);
  })();
}

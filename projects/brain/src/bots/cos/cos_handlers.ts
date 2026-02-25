// src/bots/cos/cos_handlers.ts
//
// ACT handlers for Chief of Staff Bot tasks.
// These get wired into src/agent/loop.ts act() dispatcher.
//
// The bot reads COS_BOT_SKILL.md at reasoning time (standard SKILL.md injection).
// All handlers follow the same REASON → ACT → OBSERVE → REFLECT pattern.
//
// ─────────────────────────────────────────────────────────────────────────────

import { sendDailyBrief, sendWeeklyMemo, DailyBriefData, WeeklyMemoData, BriefStatus } from './cos_email';

export async function handleAssessStrategicPriorities(task: any, db: any): Promise<any> {
  const [isScores, regimeState, pipelineHealth, circuitBreakerFacts, strategyOutcomes] = await Promise.all([
    loadIsTrjectory(db, 30),
    loadCurrentRegime(db),
    loadPipelineHealth(db),
    loadCircuitBreakerFacts(db, 30),
    loadStrategyOutcomesSummary(db, 90),
  ]);

  // Reason (LLM call) → StrategicPrioritiesOutput JSON
  // Store as TWO semantic facts:
  // domain='cos_strategic_priorities_deployment' ttl_hours=24 (desk postures)
  // domain='cos_strategic_priorities_firm' ttl_hours=168 (top_priorities, watching)
  // If bottleneck_detected: seed seedBottleneckEvalTask()
  // If regime_alignment_gap: seed seedRegimeAlignmentTask()

  return {
    observation: {
      priorities_set: true,
      crypto_posture: 'see semantic fact',
      prediction_posture: 'see semantic fact',
      bottleneck_detected: false,
      regime_gap_detected: false,
    },
    outcome_score: 0.7, // lagged — scored 30 days later
  };
}

export async function handleGenerateDailyBrief(task: any, db: any): Promise<any> {
  const prioritiesFact = await loadStrategicPrioritiesFact(db);
  const botStates = await loadBotStates(db);
  const capitalSnap = await loadCapitalSnapshot(db);
  const regimeState = await loadCurrentRegime(db);
  const yesterdayRpt = await loadYesterdayReportSummary(db);

  const pf: any = prioritiesFact as any;
  const prioritiesAge = pf
    ? (Date.now() - new Date(String(pf.created_at)).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  const prioritiesIsInvalidated = String(pf?.fact ?? pf?.content ?? '').includes('"invalidated": true');
  const stateChangedSinceAssessment = await detectStateChangeSince(db, pf?.created_at);
  const prioritiesAreStale = prioritiesAge > 3 && stateChangedSinceAssessment;

  const dominantState = computeDominantState(botStates);

  // Reason (LLM call) → DailyBriefData JSON
  // If prioritiesAreStale: add [PRIORITIES STALE] warning to prompt, seed new assess task
  // If prioritiesIsInvalidated: do not cite deployment thesis, set status=NEEDS INPUT

  const briefData: DailyBriefData = {
    date: task.task_input.report_date,
    status: 'ALL CLEAR' as BriefStatus,
    system_state: dominantState,
    capital_usd: capitalSnap.total_capital ?? 10000,
    capital_change_pct: capitalSnap.today_pct ?? 0,
    vol_regime: regimeState.regime ?? 'normal',
    regime_desk: regimeState.desk ?? 'crypto',
    action_required: null,
    yesterday_summary: 'System running normally.',
    priorities: [
      'Priority 1 from CoS reasoning',
      'Priority 2 from CoS reasoning',
      'Priority 3 from CoS reasoning',
    ],
    watching: [],
  };

  const sendResult = await sendDailyBriefWithRetry(briefData, 3);

  if (!sendResult.success) {
    console.error(`[CoS] Daily brief send failed after 3 attempts: ${sendResult.error}`);
    await writeDeliveryFailedFlag(db, 'generate_daily_brief', briefData.date, sendResult.error ?? 'unknown');
    return {
      observation: {
        sent: false,
        error: sendResult.error,
        delivery_failed_flag_written: true,
      },
      outcome_score: 0,
    };
  }

  console.log(`[CoS] Daily brief sent. Message ID: ${sendResult.message_id}`);

  return {
    observation: {
      sent: true,
      message_id: sendResult.message_id,
      status: briefData.status,
      date: briefData.date,
    },
    outcome_score: 1,
  };
}

export async function handleGenerateWeeklyMemo(task: any, db: any): Promise<any> {
  const { week_number, date_range_start, date_range_end } = task.task_input;

  const [
    prioritiesFact,
    weeklyReports,
    isTrajectory,
    strategyHealthWeek,
    circuitBreakerEventsWeek,
    learningVelocity,
  ] = await Promise.all([
    loadStrategicPrioritiesFact(db),
    loadWeeklyDailyReports(db, date_range_start, date_range_end),
    loadIsTrjectory(db, 14),
    loadStrategyHealthForWeek(db, date_range_start, date_range_end),
    loadCircuitBreakerFacts(db, 7),
    loadLearningVelocityMetrics(db),
  ]);

  // Reason (LLM call) → full_memo_markdown string

  const memoData: WeeklyMemoData = {
    week_number,
    date_range: formatDateRange(date_range_start, date_range_end),
    capital_performance: '',
    regime_alignment: '',
    pipeline_health: '',
    bottleneck_analysis: '',
    blind_spot_review: '',
    decision_packets: 'None pending.',
    next_week_priorities: '',
    full_memo_markdown: '',
  };

  const sendResult = await sendWeeklyMemo(memoData);

  if (!sendResult.success) {
    console.error(`[CoS] Weekly memo send failed: ${sendResult.error}`);
    return { observation: { sent: false, error: sendResult.error }, outcome_score: 0 };
  }

  console.log(`[CoS] Weekly memo sent. Week ${week_number}. Message ID: ${sendResult.message_id}`);

  return {
    observation: {
      sent: true,
      message_id: sendResult.message_id,
      week_number,
      date_range: memoData.date_range,
    },
    outcome_score: 1,
  };
}

export async function handleDetectSystematicBlindSpots(task: any, db: any): Promise<any> {
  // Stress-state deferral: if 2+ bots PAUSED/DIAGNOSTIC, circuit breaker in last 7 days,
  // or any IS < -0.10 → defer 2 weeks, write episode, do NOT escalate.
  //
  // const botStates = await loadBotStates(db);
  // const stressedBotCount = botStates.filter(b =>
  //   ['PAUSED','DIAGNOSTIC'].includes(b.current_state?.toUpperCase())
  // ).length;
  // const recentCircuitBreaker = await loadCircuitBreakerFacts(db, 7);
  // const minIS = await loadMinISScore(db);
  // if (stressedBotCount >= 2 || recentCircuitBreaker.length > 0 || minIS < -0.10) {
  //   return { observation: { deferred: true, reason: 'system_under_stress' }, outcome_score: 0.7 };
  // }

  // Reason → structural risks JSON (3-5 items)
  // Store as semantic fact domain='cos_blind_spot_review'
  // If severity=high items exist: surface in next daily report NEEDS ATTENTION

  return {
    observation: {
      risks_identified: 0,
      high_severity_count: 0,
      review_date: new Date().toISOString(),
    },
    outcome_score: 0.7,
  };
}

export async function handleGenerateDecisionPacket(task: any, db: any): Promise<any> {
  // Reason → decision packet JSON
  // Include in next daily brief as action_required
  // If urgency === 'now' or 'before_market_open': send immediate email

  return {
    observation: {
      packet_generated: true,
      urgency: 'eod',
      topic: task.task_input.topic,
    },
    outcome_score: 0.7,
  };
}

export async function handleReviewRegimeStrategyAlignment(task: any, db: any): Promise<any> {
  // Reason → alignment assessment

  // Directive TTL: tied to regime state, not calendar time
  // - directives include the regime they were written for
  // - Orchestrator checks current regime matches before executing
  // - assess_strategic_priorities explicitly revokes stale directives

  // Asymmetric lag:
  // const lagThreshold = isShiftTowardCaution(task.task_input.current_regime) ? 1 : 3;
  // if (task.task_input.regime_age_days < lagThreshold) return early

  // Mid-cycle tracking: write 'cos_thesis_tracking' semantic fact with 7day_check_due_at

  return {
    observation: {
      aligned: true,
      misaligned_count: 0,
      directive_issued: false,
      directive_regime: null,
      lag_threshold_applied: null,
    },
    outcome_score: 0.7,
  };
}

export async function handleEvaluateBottlenecks(task: any, db: any): Promise<any> {
  // Reason → bottleneck diagnosis (capacity | calibration | insufficient_data)
  // If capacity: seed directive to Orchestrator via semantic fact
  // If calibration: generate_decision_packet for Managing Partner

  return {
    observation: {
      diagnosis: 'insufficient_data',
      confidence: 0,
      action_taken: 'none',
    },
    outcome_score: 0.7,
  };
}

// ── Data loaders (stubs — real queries wired in Block 5) ──────────────────────

async function loadIsTrjectory(db: any, days: number) {
  // SELECT bot_id, is_score, evaluated_at FROM intelligence_scores
  // WHERE evaluated_at >= NOW() - INTERVAL '${days} days'
  // ORDER BY bot_id, evaluated_at DESC
  return [];
}

async function loadCurrentRegime(db: any) {
  const { data } = await db
    .from('operational_state')
    .select('value,published_at,expires_at')
    .eq('domain', 'regime_state')
    .eq('key', 'vol_regime')
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!data) return { regime: 'normal', desk: 'unknown', age_days: 0 };
  const publishedAt = new Date(data.published_at);
  const ageDays = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);

  const v: any = (data as any).value ?? {};
  return {
    regime: v.vol_regime ?? 'normal',
    desk: v.desk ?? 'unknown',
    age_days: Math.floor(ageDays),
  };
}

async function loadPipelineHealth(db: any) {
  return {};
}

async function loadCircuitBreakerFacts(db: any, days: number) {
  return [];
}

async function loadStrategyOutcomesSummary(db: any, days: number) {
  return {};
}

async function loadStrategicPrioritiesFact(db: any) {
  // SELECT content, created_at FROM semantic_facts
  // WHERE domain = 'cos_strategic_priorities_firm'
  // ORDER BY created_at DESC LIMIT 1
  return null;
}

async function loadBotStates(db: any) {
  // SELECT bot_id, current_state, updated_at FROM bot_states
  return [];
}

async function loadCapitalSnapshot(db: any) {
  return { total_capital: 10000, today_pct: 0 };
}

async function loadYesterdayReportSummary(db: any) {
  return '';
}

async function loadWeeklyDailyReports(db: any, start: string, end: string) {
  return [];
}

async function loadStrategyHealthForWeek(db: any, start: string, end: string) {
  return {};
}

async function loadLearningVelocityMetrics(db: any) {
  return {};
}

async function loadMinISScore(db: any): Promise<number> {
  return 0.5;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function detectStateChangeSince(db: any, since: string | undefined): Promise<boolean> {
  if (!since) return true;
  // Check for circuit breaker facts, bot state transitions to PAUSED/DIAGNOSTIC,
  // or regime changes — all newer than 'since'. Returns true if any exist.
  return false;
}

export async function invalidateCosDeploymentThesis(db: any, reason: string): Promise<void> {
  await db.from('semantic_facts').insert({
    domain: 'cos_strategic_priorities',
    fact_type: 'failure_pattern',
    fact: JSON.stringify({
      invalidated: true,
      reason,
      invalidated_at: new Date().toISOString(),
    }),
    confidence: 1.0,
    supporting_episode_ids: [],
    times_confirmed: 1,
    times_violated: 0,
    status: 'active',
  });
  console.log(`[CoS] Deployment thesis invalidated: ${reason}`);
}

async function sendDailyBriefWithRetry(
  data: any,
  maxAttempts: number,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const { sendDailyBrief } = await import('./cos_email');
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sendDailyBrief(data);
    if (result.success) return result;
    lastError = result.error ?? 'unknown';
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  return { success: false, error: `Failed after ${maxAttempts} attempts: ${lastError}` };
}

async function writeDeliveryFailedFlag(db: any, taskType: string, date: string, error: string): Promise<void> {
  await db.from('semantic_facts').insert({
    domain: 'cos_delivery_failure',
    fact_type: 'failure_pattern',
    fact: JSON.stringify({ task_type: taskType, date, error, attempts: 3 }),
    confidence: 1.0,
    supporting_episode_ids: [],
    times_confirmed: 1,
    times_violated: 0,
    status: 'active',
  });
}

export async function computeEscalationMetrics(
  db: any,
  windowDays: number,
): Promise<{ total_packets: number; unnecessary_escalations: number; under_escalations: number }> {
  return { total_packets: 0, unnecessary_escalations: 0, under_escalations: 0 };
}

function computeDominantState(botStates: any[]): string {
  if (!botStates.length) return 'EXPLOITING';
  const states = botStates.map((b: any) => b.current_state?.toUpperCase() ?? 'EXPLOITING');
  for (const s of ['PAUSED', 'DIAGNOSTIC', 'CAUTIOUS', 'RECOVERING']) {
    if (states.includes(s)) return s;
  }
  return 'EXPLOITING';
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (s.getMonth() === e.getMonth()) {
    return `${months[s.getMonth()]} ${s.getDate()} – ${e.getDate()}`;
  }
  return `${months[s.getMonth()]} ${s.getDate()} – ${months[e.getMonth()]} ${e.getDate()}`;
}

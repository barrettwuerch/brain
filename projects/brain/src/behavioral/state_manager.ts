import 'dotenv/config';

import type { BotBehavioralState, BotState, StateCheckResult, Task } from '../types';

import { supabaseAdmin } from '../lib/supabase';

function nowIso() {
  return new Date().toISOString();
}

function coalesceRole(role?: string | null): string {
  return role && role.trim() ? role : 'research';
}

function coalesceDesk(desk?: string | null): string {
  return desk && desk.trim() ? desk : 'general';
}

export async function readBotState(botId: string): Promise<BotState | null> {
  const { data, error } = await supabaseAdmin
    .from('bot_states')
    .select('*')
    .eq('bot_id', botId)
    .maybeSingle();

  if (error) throw error;
  return (data as any) ?? null;
}

export async function readOrCreateBotState(
  botId: string,
  agent_role?: string | null,
  desk?: string | null,
): Promise<BotState> {
  const existing = await readBotState(botId);
  if (existing) return existing;

  const row: Partial<BotState> = {
    bot_id: botId,
    agent_role: coalesceRole(agent_role),
    desk: coalesceDesk(desk),

    current_state: 'exploiting',
    state_since: nowIso(),
    reason: null,
    requires_manual_review: false,

    warm_up: true,
    warm_up_episodes_remaining: 20,

    is_at_entry: null,

    consecutive_wins: 0,
    consecutive_losses: 0,
    trades_in_state: 0,
    good_is_windows: 0,

    peak_outcome_score: null,
    current_drawdown: null,
    drawdown_velocity: null,
    profit_factor: null,

    diagnostic_attempts: 0,
    diagnostic_max: 10,
    last_root_cause: null,

    updated_at: nowIso(),
  };

  const { data, error } = await supabaseAdmin
    .from('bot_states')
    .insert(row)
    .select('*')
    .single();

  if (error) throw error;
  return data as any;
}

/**
 * Write a state transition. Always logs to bot_state_transitions.
 */
export async function transitionState(
  botId: string,
  toState: BotBehavioralState,
  reason: string,
  metricSnapshot?: Record<string, any>,
): Promise<void> {
  const current = await readBotState(botId);
  const fromState: BotBehavioralState = (current?.current_state ?? 'exploiting') as BotBehavioralState;

  // audit log (append-only)
  const { error: logErr } = await supabaseAdmin.from('bot_state_transitions').insert({
    bot_id: botId,
    from_state: fromState,
    to_state: toState,
    reason,
    metric_snapshot: metricSnapshot ?? null,
  });
  if (logErr) throw logErr;

  // state update
  const { error: updErr } = await supabaseAdmin
    .from('bot_states')
    .update({
      current_state: toState,
      state_since: nowIso(),
      reason,
      updated_at: nowIso(),
    })
    .eq('bot_id', botId);
  if (updErr) throw updErr;
}

export async function triggerDiagnostic(botId: string): Promise<void> {
  // Pass 2 implements real diagnostic runs. Pass 1: log only.
  console.log(`[diagnostic] triggerDiagnostic stub for bot_id=${botId}`);
}

export function evaluateCautiousTransition(
  _botId: string,
  recentISScores: number[],
): 'stay' | 'exploiting' | 'paused' {
  const xs = recentISScores.map(Number).filter((n) => Number.isFinite(n));

  if (xs.length >= 3) {
    const last3 = xs.slice(0, 3);
    if (last3.every((v) => v > 0.05)) return 'exploiting';
  }

  if (xs.length >= 1 && xs[0] < -0.1) return 'paused';

  return 'stay';
}

/**
 * Phase 6: decrement warm-up counter after an episode is written.
 * Hard constraint: bot_states writes must be centralized here.
 */
export async function decrementWarmUpAfterEpisode(botId: string): Promise<void> {
  const state = await readBotState(botId);
  if (!state) return;
  if (!state.warm_up) return;

  const remaining = Math.max(0, Number(state.warm_up_episodes_remaining ?? 0) - 1);
  const warm_up = remaining > 0;

  const { error } = await supabaseAdmin
    .from('bot_states')
    .update({
      warm_up,
      warm_up_episodes_remaining: remaining,
      updated_at: nowIso(),
    })
    .eq('bot_id', botId);

  if (error) throw error;
}

/**
 * Called as first step in BrainLoop.run() BEFORE reason().
 * Returns shouldAbort=true if bot is PAUSED or DIAGNOSTIC.
 */
export async function checkStateBeforeRun(task: Task): Promise<StateCheckResult> {
  const botId = task.bot_id ?? 'default';
  const state = await readOrCreateBotState(botId, task.agent_role ?? null, task.desk ?? null);

  if (state.warm_up) {
    return { shouldAbort: false, reason: 'warm_up', state: state.current_state };
  }

  if (state.requires_manual_review) {
    return { shouldAbort: true, reason: 'requires_manual_review', state: 'paused' };
  }

  if (state.current_state === 'paused' || state.current_state === 'diagnostic') {
    if (state.current_state === 'paused' && state.diagnostic_attempts === 0) {
      await transitionState(botId, 'diagnostic', 'auto: entered from paused');
      // async fire-and-forget; do not block this run
      triggerDiagnostic(botId).catch((e) => console.error(e));
    }
    return { shouldAbort: true, reason: state.current_state, state: state.current_state };
  }

  return { shouldAbort: false, reason: 'ok', state: state.current_state };
}

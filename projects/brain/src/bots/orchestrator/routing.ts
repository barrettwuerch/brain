import 'dotenv/config';

import type { ResearchFinding, Task } from '../../types';

import { supabaseAdmin } from '../../lib/supabase';
import { getFindingsByStatus, updateFindingStatus } from '../../db/research_findings';
import { transitionState } from '../../behavioral/state_manager';
import {
  generateEscalationNotice,
  identifyUnroutedFindings,
  shouldAutoApproveRecovery,
} from './orchestrator_compute';

export async function registerWatchConditions(approvedFindings: ResearchFinding[]): Promise<number> {
  let registered = 0;

  for (const f of approvedFindings) {
    // Find most recent formalize_strategy episode for this finding.
    const { data: eps, error: epsErr } = await supabaseAdmin
      .from('episodes')
      .select('id,action_taken,task_input,lessons,created_at')
      .eq('task_type', 'formalize_strategy')
      .order('created_at', { ascending: false })
      .limit(50);
    if (epsErr) throw epsErr;

    const ep = (eps ?? []).find((e: any) => {
      const findingId = e?.action_taken?.formalization?.finding_id ?? e?.task_input?.finding?.id;
      return String(findingId) === String(f.id);
    });

    const formalization = ep?.action_taken?.formalization ?? null;
    const wc = formalization?.watch_condition ?? null;
    if (!wc) continue;

    const bot_id = String((f as any).market_type) === 'crypto' ? 'crypto-execution-bot-1' : 'execution-bot-1';
    const ticker = (f as any).market ?? (String((f as any).market_type) === 'crypto' ? 'BTC/USD' : '');

    const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const toCreate: any = {
      strategy_id: String(f.id),
      bot_id,
      market_type: (f as any).market_type ?? 'prediction',
      ticker,
      condition_type: 'threshold',
      metric: wc.metric,
      operator: wc.operator,
      value: wc.value,
      timeframe: wc.timeframe,
      action_type: 'size_position',
      action_params: {
        // Risk sizing inputs (drawdownPct/baseKellySize) are filled at fire time by the Scanner.
        continuation: {
          task_type: 'place_limit_order',
          agent_role: 'execution',
          bot_id,
          desk: String((f as any).market_type) === 'crypto' ? 'crypto_markets' : 'prediction_markets',
          task_input: {
            symbol: ticker,
            side: 'buy',
            // Placeholder until we wire a proper price/limit model per strategy.
            // For now we set limitPrice equal to the watch threshold value.
            limitPrice: wc.value,
          },
        },
      },
      max_triggers_per_day: wc.max_triggers_per_day,
      cooldown_minutes: wc.cooldown_minutes,
      active_hours: null,
      vol_regime_gate: wc.vol_regime_gate ?? null,
      status: 'active',
      last_triggered: null,
      trigger_count: 0,
      expires_at,
      registered_by: 'orchestrator',
    };

    const { createWatchCondition } = await import('../../db/watch_conditions');
    const created = await createWatchCondition(toCreate);
    console.log(`[ORCHESTRATOR] Registered watch condition for ${ticker} metric=${wc.metric}`);
    registered++;
  }

  return registered;
}

export async function routeUnroutedFindings(): Promise<number> {
  const findings = await getFindingsByStatus('under_investigation');
  const candidates = findings.filter((f) => Number((f as any).rqs_score ?? 0) >= 0.45);

  const { data: existingTasks, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('task_type', 'formalize_strategy')
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;

  let unrouted = identifyUnroutedFindings(candidates as any, (existingTasks ?? []) as any);

  // Gate: do not route findings while adversarial mechanism validation is pending.
  // (Mechanism validation is seeded when mechanism_clarity < 0.6.)
  const { data: pendingMech, error: pmErr } = await supabaseAdmin
    .from('tasks')
    .select('task_input,status')
    .eq('task_type', 'validate_edge_mechanism')
    .in('status', ['queued', 'running'])
    .limit(2000);
  if (pmErr) throw pmErr;

  const pendingIds = new Set(
    (pendingMech ?? [])
      .map((t: any) => String(t?.task_input?.finding_id ?? ''))
      .filter((x: string) => x.length > 0),
  );

  if (pendingIds.size) {
    unrouted = unrouted.filter((f: any) => !pendingIds.has(String(f.id)));
  }

  let routed = 0;

  for (const f of unrouted) {
    const isCrypto = String((f as any).market_type ?? 'prediction') === 'crypto';

    // Task 1: formalize
    const ins1: any = {
      task_type: isCrypto ? 'formalize_crypto_strategy' : 'formalize_strategy',
      task_input: { finding: f, priority: 1 },
      status: 'queued',
      tags: ['strategy', isCrypto ? 'crypto' : 'prediction_markets', 'priority:1'],
      agent_role: 'strategy',
      desk: isCrypto ? 'crypto_markets' : 'prediction_markets',
      bot_id: isCrypto ? 'crypto-strategy-bot-1' : 'strategy-bot-1',
    };

    // Task 2: challenge (adversarial review) — seeds backtest ONLY if verdict=proceed
    const ins2: any = {
      task_type: isCrypto ? 'challenge_crypto_strategy' : 'challenge_strategy',
      task_input: {
        finding_id: f.id,
      },
      status: 'queued',
      tags: ['strategy', isCrypto ? 'crypto' : 'prediction_markets', 'priority:1'],
      agent_role: 'strategy',
      desk: isCrypto ? 'crypto_markets' : 'prediction_markets',
      bot_id: isCrypto ? 'crypto-strategy-bot-1' : 'strategy-bot-1',
    };

    const { error: insErr1 } = await supabaseAdmin.from('tasks').insert(ins1);
    if (insErr1) throw insErr1;

    const { error: insErr2 } = await supabaseAdmin.from('tasks').insert(ins2);
    if (insErr2) throw insErr2;

    await updateFindingStatus(String(f.id), 'passed_to_backtest');
    routed++;
  }

  return routed;
}

export async function runRegisterWatchConditions(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('research_findings')
    .select('*')
    .eq('status', 'in_backtest')
    .eq('recommendation', 'approved_for_forward_test')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return await registerWatchConditions((data ?? []) as any);
}

export async function reviewAndTransitionBots(): Promise<string[]> {
  const actions: string[] = [];

  const { data: states, error } = await supabaseAdmin.from('bot_states').select('*');
  if (error) throw error;

  for (const s of states ?? []) {
    const bs = s as any;
    if (shouldAutoApproveRecovery(bs)) {
      await transitionState(String(bs.bot_id), 'recovering', 'orchestrator_auto_approved');
      actions.push(`auto_approved:${bs.bot_id}`);
    }

    // Recovery completion: when recovering and drawdown has been cleared, step down into CAUTIOUS.
    // This supports the Gate 2 full recovery cycle.
    if (String(bs.current_state) === 'recovering') {
      const dd = Number(bs.current_drawdown ?? 0);
      if (dd <= 0.001) {
        await transitionState(String(bs.bot_id), 'cautious', 'orchestrator_recovery_complete', { current_drawdown: dd });
        actions.push(`recovered_to_cautious:${bs.bot_id}`);
      }
    }

    if (String(bs.current_state) === 'diagnostic' && Boolean(bs.requires_manual_review) === true) {
      const notice = generateEscalationNotice('bot requires manual review', [String(bs.bot_id)], {
        requires_manual_review: true,
        states: { [String(bs.bot_id)]: bs },
      });
      console.log('[ESCALATION]', notice);
      actions.push(`escalated:${bs.bot_id}`);
    }
  }

  return actions;
}

export async function updateStaleWatchConditions(): Promise<number> {
  const { data: facts, error } = await supabaseAdmin
    .from('semantic_facts')
    .select('fact,confidence')
    .eq('fact_type', 'success_pattern')
    .gt('confidence', 0.8)
    .ilike('fact', '%threshold%')
    .order('last_updated', { ascending: false })
    .limit(50);
  if (error) throw error;

  const { data: conds, error: cErr } = await supabaseAdmin
    .from('watch_conditions')
    .select('id,ticker,metric,value,status')
    .eq('status', 'active');
  if (cErr) throw cErr;

  let flagged = 0;

  for (const f of facts ?? []) {
    const text = String((f as any).fact ?? '');
    const mMetric = text.match(/metric=([a-zA-Z_]+)/);
    const mVal = text.match(/threshold=([0-9.]+)/);
    if (!mMetric || !mVal) continue;

    const metric = mMetric[1];
    const suggested = Number(mVal[1]);
    if (!Number.isFinite(suggested)) continue;

    for (const c of conds ?? []) {
      const row: any = c;
      if (String(row.metric) !== metric) continue;
      const cur = Number(row.value);
      if (!Number.isFinite(cur)) continue;
      if (Math.abs(cur - suggested) / Math.max(Math.abs(cur), 1e-9) > 0.25) {
        console.log(`[ORCHESTRATOR] Watch condition ${row.id} may need threshold update: current=${cur}, semantic fact suggests ${suggested}`);
        flagged++;
      }
    }
  }

  return flagged;
}

export async function checkForCircuitBreakerEscalations(): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('bot_state_transitions')
    .select('created_at,reason,metric_snapshot')
    .ilike('reason', 'circuit_breaker%')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const uniq = new Map<string, any>();
  for (const r of data ?? []) {
    const key = String((r as any).reason);
    if (!uniq.has(key)) uniq.set(key, r);
  }

  const { data: states } = await supabaseAdmin.from('bot_states').select('bot_id,current_state,reason');
  const stateMap: Record<string, any> = {};
  for (const s of states ?? []) stateMap[String((s as any).bot_id)] = s;

  const notices: string[] = [];
  for (const [reason, row] of uniq.entries()) {
    const breach = reason.replace('circuit_breaker:', '').trim();
    const metrics = (row as any).metric_snapshot ?? {};
    const botsAffected = Object.keys(stateMap).filter((b) => String(stateMap[b].reason ?? '').includes('circuit_breaker'));
    const notice = generateEscalationNotice(`Circuit breaker fired: ${breach}`, botsAffected, { ...metrics, states: stateMap });
    console.log('[ESCALATION]', notice);
    notices.push(notice);
  }

  return notices;
}

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

export async function routeUnroutedFindings(): Promise<number> {
  const findings = await getFindingsByStatus('under_investigation');
  const candidates = findings.filter((f) => Number((f as any).rqs_score ?? 0) >= 0.65);

  const { data: existingTasks, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('task_type', 'formalize_strategy')
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;

  const unrouted = identifyUnroutedFindings(candidates as any, (existingTasks ?? []) as any);

  let routed = 0;

  for (const f of unrouted) {
    // Task 1: formalize
    const ins1: any = {
      task_type: 'formalize_strategy',
      task_input: { finding: f, priority: 1 },
      status: 'queued',
      tags: ['strategy', 'prediction_markets', 'priority:1'],
      agent_role: 'strategy',
      desk: 'prediction_markets',
      bot_id: 'strategy-bot-1',
    };

    // Task 2: backtest (dev outcomes; variance present)
    const outcomes = Array.from({ length: 120 }, (_, i) => {
      const pattern = [1, 1, 0, 1, 0];
      return pattern[i % pattern.length];
    });

    const ins2: any = {
      task_type: 'run_backtest',
      task_input: {
        formalization: {
          finding_id: f.id,
          entry_conditions: 'stub',
          exit_conditions: 'stub',
          position_sizing_rule: 'Kelly 0.25x',
          invalidation_criteria: 'IS drops below 0.05 for 2 consecutive evaluations',
          market_scope: (f as any).market ?? 'general',
          created_at: new Date().toISOString(),
          created_by: 'strategy-bot-1',
        },
        outcomes,
        slippage: 0.0015,
        priority: 1,
      },
      status: 'queued',
      tags: ['strategy', 'prediction_markets', 'priority:1'],
      agent_role: 'strategy',
      desk: 'prediction_markets',
      bot_id: 'strategy-bot-1',
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

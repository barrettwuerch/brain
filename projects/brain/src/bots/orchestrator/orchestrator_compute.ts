// Orchestrator computations (pure; no DB writes; no API calls)

import type { BotState, ResearchFinding, Task } from '../../types';

export function computeDeskPriorities(
  botStates: BotState[],
  isScores: Record<string, number>,
): Record<string, 'increase' | 'maintain' | 'reduce'> {
  // Group bots by desk
  const desks = new Map<string, BotState[]>();
  for (const b of botStates) {
    const d = String(b.desk ?? 'general');
    const arr = desks.get(d) ?? [];
    arr.push(b);
    desks.set(d, arr);
  }

  const out: Record<string, 'increase' | 'maintain' | 'reduce'> = {};

  for (const [desk, bots] of desks.entries()) {
    const anyPaused = bots.some((b) => b.current_state === 'paused' || b.current_state === 'diagnostic');
    if (anyPaused) {
      out[desk] = 'reduce';
      continue;
    }

    const botIs = bots.map((b) => isScores[b.bot_id]).filter((v) => typeof v === 'number');
    if (botIs.length && botIs.every((v) => v < 0.05)) {
      out[desk] = 'reduce';
      continue;
    }

    const anyGood = bots.some((b) => typeof isScores[b.bot_id] === 'number' && isScores[b.bot_id] > 0.15 && b.current_state === 'exploiting');
    if (anyGood) {
      out[desk] = 'increase';
      continue;
    }

    out[desk] = 'maintain';
  }

  return out;
}

export function shouldAutoApproveRecovery(botState: BotState): boolean {
  if (botState.current_state !== 'diagnostic') return false;
  if (botState.requires_manual_review) return false;
  const updated = new Date(String(botState.updated_at)).getTime();
  if (!Number.isFinite(updated)) return false;
  return Date.now() - updated > 60 * 60 * 1000;
}

export function generateEscalationNotice(
  event: string,
  affectedBots: string[],
  metrics: Record<string, any>,
): string {
  const date = new Date().toISOString();
  const statusLines = (metrics.states ?? {}) as Record<string, any>;

  const states = affectedBots
    .map((b) => {
      const s = statusLines[b];
      if (!s) return `${b}: (state unknown)`;
      return `${b}: ${s.current_state}${s.reason ? ` (${s.reason})` : ''}`;
    })
    .join(', ');

  // Key numbers only
  const keys = ['drawdown', 'threshold', 'enp', 'kelly_multiplier', 'open_positions', 'unrealized_pnl'];
  const nums: string[] = [];
  for (const k of keys) {
    if (metrics[k] !== undefined) nums.push(`${k}=${metrics[k]}`);
  }

  const actionNeeded = metrics.requires_manual_review ? 'Yes — Managing Partner review required.' : 'No — informational.';

  return [
    `DESK ALERT — ${date}`,
    `What happened: ${event}`,
    `Bots affected: ${affectedBots.join(', ') || '(none)'}`,
    `Current status: ${states || '(unknown)'}`,
    `Metrics: ${nums.join(', ') || '(none)'}`,
    `Action needed: ${actionNeeded}`,
  ].join('\n');
}

export function identifyUnroutedFindings(findings: ResearchFinding[], existingStrategyTasks: Task[]): ResearchFinding[] {
  const routedIds = new Set<string>();
  for (const t of existingStrategyTasks) {
    const f = (t as any)?.task_input?.finding;
    const id = f?.id ? String(f.id) : null;
    if (id) routedIds.add(id);
  }

  return findings.filter((f) => {
    const rqs = Number((f as any).rqs_score ?? 0);
    const ok = rqs >= 0.65 && f.status === 'under_investigation';
    return ok && !routedIds.has(String(f.id));
  });
}

// Inline test
if (process.argv[1]?.endsWith('orchestrator_compute.ts')) {
  const botStates: any[] = [
    { bot_id: 'a', desk: 'prediction_markets', current_state: 'exploiting', requires_manual_review: false, updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { bot_id: 'b', desk: 'prediction_markets', current_state: 'paused', requires_manual_review: false, updated_at: new Date().toISOString() },
    { bot_id: 'c', desk: 'general', current_state: 'exploiting', requires_manual_review: false, updated_at: new Date().toISOString() },
  ];
  console.log('computeDeskPriorities', computeDeskPriorities(botStates as any, { a: 0.2, b: 0.1, c: 0.01 }));
  console.log('shouldAutoApproveRecovery', shouldAutoApproveRecovery({ ...botStates[0], current_state: 'diagnostic' } as any));
  console.log(
    'generateEscalationNotice',
    generateEscalationNotice('circuit breaker fired', ['a', 'b'], { threshold: 0.15, drawdown: 0.16, states: { a: botStates[0], b: botStates[1] } }),
  );
  const findings: any[] = [
    { id: 'f1', status: 'under_investigation', rqs_score: 0.7 },
    { id: 'f2', status: 'archived', rqs_score: 0.9 },
  ];
  const tasks: any[] = [{ id: 't1', task_input: { finding: { id: 'f2' } } }];
  console.log('identifyUnroutedFindings', identifyUnroutedFindings(findings as any, tasks as any));
}

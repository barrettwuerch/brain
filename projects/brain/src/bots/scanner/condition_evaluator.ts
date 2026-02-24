import type { WatchCondition } from '../../types';

export function evaluateCondition(
  condition: WatchCondition,
  currentValue: number,
  previousValue?: number,
): boolean {
  const v = Number(condition.value);
  const c = Number(currentValue);
  const p = previousValue === undefined ? undefined : Number(previousValue);

  switch (condition.operator) {
    case '>':
      return c > v;
    case '<':
      return c < v;
    case '>=':
      return c >= v;
    case '<=':
      return c <= v;
    case '==':
      return Math.abs(c - v) < 0.0001;
    case 'crosses_above':
      if (p === undefined) return false;
      return p <= v && c > v;
    case 'crosses_below':
      if (p === undefined) return false;
      return p >= v && c < v;
    default:
      return false;
  }
}

export function isOnCooldown(condition: WatchCondition): boolean {
  if (!condition.last_triggered) return false;
  const last = new Date(condition.last_triggered).getTime();
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < Number(condition.cooldown_minutes) * 60 * 1000;
}

export function isWithinActiveHours(condition: WatchCondition): boolean {
  if (!condition.active_hours) return true;
  const m = String(condition.active_hours).match(/^(\d\d):(\d\d)-(\d\d):(\d\d)$/);
  if (!m) return true;

  const [_, sh, sm, eh, em] = m;
  const startMin = Number(sh) * 60 + Number(sm);
  const endMin = Number(eh) * 60 + Number(em);

  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  if (endMin >= startMin) return nowMin >= startMin && nowMin <= endMin;
  // wraps midnight
  return nowMin >= startMin || nowMin <= endMin;
}

export function checkVolRegimeGate(condition: WatchCondition, currentRegime: string): boolean {
  if (!condition.vol_regime_gate) return true;
  const order: Record<string, number> = { low: 0, normal: 1, elevated: 2, extreme: 3 };
  const cur = order[String(currentRegime)] ?? 1;
  const gate = order[String(condition.vol_regime_gate)] ?? 3;
  return cur <= gate;
}

export function shouldFire(
  condition: WatchCondition,
  currentValue: number,
  previousValue: number | undefined,
  currentVolRegime: string,
): { fire: boolean; reason: string } {
  if (isOnCooldown(condition)) return { fire: false, reason: 'cooldown' };
  if (!isWithinActiveHours(condition)) return { fire: false, reason: 'outside_hours' };
  if (!checkVolRegimeGate(condition, currentVolRegime)) return { fire: false, reason: 'regime_gate' };
  if (!evaluateCondition(condition, currentValue, previousValue)) return { fire: false, reason: 'condition_not_met' };
  return { fire: true, reason: 'condition_met' };
}

// Inline test
if (process.argv[1]?.endsWith('condition_evaluator.ts')) {
  const base: any = {
    id: 'x',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    strategy_id: 's',
    bot_id: 'b',
    market_type: 'crypto',
    ticker: 'BTC/USD',
    condition_type: 'threshold',
    metric: 'price',
    operator: '>=',
    value: 10,
    timeframe: '1h',
    action_type: 'alert_only',
    action_params: {},
    max_triggers_per_day: 3,
    cooldown_minutes: 60,
    active_hours: null,
    vol_regime_gate: 'elevated',
    status: 'active',
    last_triggered: null,
    trigger_count: 0,
    expires_at: null,
    registered_by: 'manual',
  };

  console.log('evaluateCondition >', evaluateCondition({ ...base, operator: '>' }, 11));
  console.log('evaluateCondition ==', evaluateCondition({ ...base, operator: '==' }, 10.00001));
  console.log('crosses_above', evaluateCondition({ ...base, operator: 'crosses_above', value: 10 }, 11, 10));
  console.log('isOnCooldown false', isOnCooldown(base));
  console.log('shouldFire', shouldFire(base, 11, undefined, 'normal'));
}

import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { getActiveWatchConditions, updateAfterTrigger, expireStaleConditions } from '../../db/watch_conditions';
import { shouldFire } from './condition_evaluator';
import { fetchMetricValue } from './metric_fetcher';

async function getVolRegimeFallback(): Promise<string> {
  // Authoritative regime_state is published by Risk Bot.
  // Expect format: "current_vol_regime={regime} desk=crypto as_of={ISO}"
  try {
    const { data } = await supabaseAdmin
      .from('semantic_facts')
      .select('fact,created_at')
      .eq('domain', 'regime_state')
      .ilike('fact', '%desk=crypto%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      console.log('[SCANNER] WARNING: No fresh regime_state from Risk Bot — defaulting to normal');
      return 'normal';
    }

    const ageMs = Date.now() - new Date(String((data as any).created_at)).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 2 * 60 * 60 * 1000) {
      console.log('[SCANNER] WARNING: No fresh regime_state from Risk Bot — defaulting to normal');
      return 'normal';
    }

    const fact = String((data as any).fact ?? '');
    const m = fact.match(/current_vol_regime=(low|normal|elevated|extreme)/i);
    if (!m) return 'normal';
    return String(m[1]).toLowerCase();
  } catch {
    console.log('[SCANNER] WARNING: No fresh regime_state from Risk Bot — defaulting to normal');
    return 'normal';
  }
}

export async function runScannerCycle(): Promise<{ conditionsChecked: number; fired: number; tasksCreated: number }> {
  const expired = await expireStaleConditions();
  if (expired) console.log('[SCANNER] expired conditions:', expired);

  const conditions = await getActiveWatchConditions();
  const volRegime = await getVolRegimeFallback();

  let fired = 0;
  let tasksCreated = 0;

  for (const c of conditions) {
    const { current, previous } = await fetchMetricValue(c);
    const result = shouldFire(c, current, previous, volRegime);

    console.log(`[SCANNER] ${c.ticker} ${c.metric}=${current} fired=${result.fire} reason=${result.reason}`);

    if (!result.fire) continue;

    if (c.action_type === 'place_limit_order') {
      const taskType = c.market_type === 'crypto' ? 'place_limit_order' : 'place_kalshi_order';
      const desk = c.market_type === 'crypto' ? 'crypto_markets' : 'prediction_markets';

      const { error } = await supabaseAdmin.from('tasks').insert({
        task_type: taskType,
        task_input: {
          ...c.action_params,
          ticker: c.ticker,
          market_type: c.market_type,
          triggered_by_condition: c.id,
        },
        status: 'queued',
        tags: ['scanner'],
        bot_id: c.bot_id,
        agent_role: 'execution',
        desk,
      });
      if (error) throw error;
      tasksCreated++;
    } else {
      console.log(`[SCANNER ALERT] ${c.ticker} ${c.metric} ${c.operator} ${c.value} — condition ${c.id}`);
    }

    await updateAfterTrigger(c.id);
    fired++;
  }

  return { conditionsChecked: conditions.length, fired, tasksCreated };
}

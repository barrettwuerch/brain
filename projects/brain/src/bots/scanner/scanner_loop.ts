import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { getActiveWatchConditions, updateAfterTrigger, expireStaleConditions } from '../../db/watch_conditions';
import { shouldFire } from './condition_evaluator';
import { fetchMetricValue } from './metric_fetcher';

async function getVolRegimeFallback(): Promise<string> {
  // semantic_facts doesn't currently store structured vol regime; simple fallback.
  return 'normal';
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

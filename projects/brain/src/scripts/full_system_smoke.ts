import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';

type SmokeSpec = {
  label: string;
  agent_role: string;
  desk: string;
  bot_id: string;
  task_type: string;
  task_input: any;
};

async function insertTask(spec: SmokeSpec) {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      task_type: spec.task_type,
      task_input: spec.task_input,
      status: 'running',
      tags: ['smoke', spec.label],
      agent_role: spec.agent_role,
      desk: spec.desk,
      bot_id: spec.bot_id,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as any;
}

async function fetchEpisodeByTaskId(taskId: string) {
  const { data, error } = await supabaseAdmin
    .from('episodes')
    .select('id,created_at,task_type,agent_role,desk,bot_id,outcome,outcome_score,reasoning_score')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function runOne(spec: SmokeSpec) {
  const task = await insertTask(spec);
  const loop = new BrainLoop();
  const out = await loop.run(task);
  if ('aborted' in out) {
    return { label: spec.label, task_id: task.id, aborted: true, reason: out.reason, state: out.state };
  }
  const ep = await fetchEpisodeByTaskId(task.id);
  return {
    label: spec.label,
    task_id: task.id,
    task_type: spec.task_type,
    bot_id: spec.bot_id,
    agent_role: spec.agent_role,
    episode: ep ?? null,
  };
}

async function main() {
  const specs: SmokeSpec[] = [
    {
      label: 'risk',
      agent_role: 'risk',
      desk: 'prediction_markets',
      bot_id: 'risk-bot-1',
      task_type: 'monitor_positions',
      task_input: { timestamp: new Date().toISOString(), positions: [], correlationMatrix: [], drawdownPct: 0, tradesSincePeak: 1, unrealizedPnlPct: 0 },
    },
    {
      label: 'orchestrator',
      agent_role: 'orchestrator',
      desk: 'prediction_markets',
      bot_id: 'orchestrator-1',
      task_type: 'review_bot_states',
      task_input: {},
    },
    {
      label: 'intelligence',
      agent_role: 'intelligence',
      desk: 'prediction_markets',
      bot_id: 'intelligence-bot-1',
      task_type: 'attribute_performance',
      task_input: {},
    },
    {
      label: 'research',
      agent_role: 'research',
      desk: 'crypto_markets',
      bot_id: 'crypto-research-bot-1',
      task_type: 'funding_rate_scan',
      task_input: { market_type: 'crypto', symbol: 'BTC', rate: 0, historical_avg: 0.0001 },
    },
    {
      label: 'strategy',
      agent_role: 'strategy',
      desk: 'prediction_markets',
      bot_id: 'strategy-bot-1',
      task_type: 'score_rqs',
      task_input: {
        finding: {
          id: 'smoke-finding',
          description: 'smoke',
          mechanism: 'smoke',
          failure_conditions: 'smoke',
          sample_size: 10,
          base_rate: 0.5,
          recommendation: 'investigate_further',
          rqs_components: { statistical_rigor: 0.5, mechanism_clarity: 0.5, novelty: 0.5, cost_adjusted_edge: 0.5 },
        },
      },
    },
    {
      label: 'execution',
      agent_role: 'execution',
      desk: 'crypto_markets',
      bot_id: 'crypto-execution-bot-1',
      task_type: 'place_limit_order',
      task_input: {
        symbol: 'BTC/USD',
        side: 'buy',
        limitPrice: 1,
        size: 0.0001,
      },
    },
    {
      label: 'cos',
      agent_role: 'chief_of_staff',
      desk: 'general',
      bot_id: 'cos-bot-1',
      task_type: 'assess_strategic_priorities',
      task_input: { report_date: new Date().toISOString().slice(0, 10) },
    },
  ];

  const results = [] as any[];
  for (const s of specs) {
    try {
      results.push(await runOne(s));
    } catch (e: any) {
      results.push({ label: s.label, task_type: s.task_type, error: String(e?.message ?? e) });
    }
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

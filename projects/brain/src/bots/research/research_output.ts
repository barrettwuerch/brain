import 'dotenv/config';

import type { Episode, ResearchFinding, RQSComponents } from '../../types';

import { writeResearchFinding, updateFindingStatus } from '../../db/research_findings';
import { supabaseAdmin } from '../../lib/supabase';
import { scoreRQS, validateSixQuestions } from './research_compute';

function asStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function asNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function formatAndStoreFinding(
  episode: Episode,
  rawOutput: Record<string, any>,
): Promise<ResearchFinding | null> {
  const ti: any = episode.task_input ?? {};

  // Parse: use task_input for six-question narrative fields; rawOutput for computed metrics.
  const components: RQSComponents | null = ti.rqs_components ?? rawOutput.components ?? null;

  // Provide a placeholder recommendation to pass six-question validation; will be overwritten below.
  const draftRecommendation = (asStr(ti.draft_recommendation) ?? 'investigate_further') as any;

  const draft: Partial<ResearchFinding> = {
    bot_id: String(episode.bot_id ?? 'research-bot-1'),
    desk: String(episode.desk ?? 'prediction_markets'),
    market_type: (String(ti.market_type ?? 'prediction') as any),
    agent_role: String(episode.agent_role ?? 'research'),

    finding_type: 'under_investigation' as any,
    edge_type: (asStr(ti.edge_type) ?? 'behavioral') as any,

    description: asStr(ti.description) ?? asStr(rawOutput.description) ?? '',
    mechanism: asStr(ti.mechanism) ?? asStr(rawOutput.mechanism),
    failure_conditions: asStr(ti.failure_conditions) ?? asStr(rawOutput.failure_conditions),
    market: asStr(ti.market_ticker) ?? asStr(ti.market) ?? asStr(rawOutput.market) ?? null,
    regime_notes: asStr(ti.regime_notes) ?? asStr(rawOutput.regime_notes),

    rqs_components: components,

    sample_size: asNum(ti.sample_size),
    observed_rate: asNum(ti.observed_rate),
    base_rate: asNum(ti.base_rate),
    lift: asNum(ti.lift),
    out_of_sample: Boolean(ti.out_of_sample ?? false),

    status: 'under_investigation' as any,
    recommendation: draftRecommendation,
    backtest_result: null,
    supporting_episode_ids: [String(episode.id)],
    notes: asStr(ti.notes) ?? asStr(rawOutput.notes),
  };

  const parent_finding_id = asStr((ti as any).parent_finding_id) ?? asStr(rawOutput.parent_finding_id);

  const v = validateSixQuestions(draft);
  if (!v.valid) {
    console.log('[research_output] invalid finding, missing:', v.missing);
    return null;
  }

  const rqs_score = components ? scoreRQS(components) : null;

  // Determine finding_type + recommendation based on RQS.
  let finding_type: any = 'under_investigation';
  let recommendation: any = null;

  if (typeof rqs_score === 'number') {
    if (rqs_score >= 0.65) {
      finding_type = 'live_edge';
      recommendation = 'pass_to_backtest';
    } else if (rqs_score >= 0.4) {
      finding_type = 'preliminary';
      recommendation = 'investigate_further';
    } else {
      finding_type = 'dead_end';
      recommendation = 'archive';
    }
  } else {
    // If no score, keep preliminary and investigate.
    finding_type = 'preliminary';
    recommendation = 'investigate_further';
  }

  const toWrite: Omit<ResearchFinding, 'id' | 'created_at'> = {
    bot_id: draft.bot_id as string,
    desk: draft.desk as string,
    market_type: (draft as any).market_type ?? 'prediction',
    agent_role: draft.agent_role as string,

    finding_type,
    edge_type: draft.edge_type as any,

    description: draft.description as string,
    mechanism: draft.mechanism ?? null,
    failure_conditions: draft.failure_conditions ?? null,
    market: draft.market ?? null,
    regime_notes: draft.regime_notes ?? null,

    rqs_score,
    rqs_components: components,

    sample_size: draft.sample_size ?? null,
    observed_rate: draft.observed_rate ?? null,
    base_rate: draft.base_rate ?? null,
    lift: draft.lift ?? null,
    out_of_sample: Boolean(draft.out_of_sample),

    status: 'under_investigation',
    recommendation,
    backtest_result: null,

    supporting_episode_ids: draft.supporting_episode_ids as string[],
    notes: draft.notes ?? null,
    parent_finding_id: parent_finding_id,
  };

  const written = await writeResearchFinding(toWrite);

  // FIX D/D3: if mechanism_clarity is low, seed adversarial mechanism validation.
  try {
    const mc = Number((toWrite as any).rqs_components?.mechanism_clarity ?? 1);
    if (written?.id && mc < 0.6) {
      await supabaseAdmin.from('tasks').insert({
        task_type: 'validate_edge_mechanism',
        task_input: {
          finding_id: written.id,
          mechanism: toWrite.mechanism ?? '',
          market_type: toWrite.market_type,
        },
        status: 'queued',
        tags: ['research', 'mechanism'],
        agent_role: 'research',
        desk: String(toWrite.market_type) === 'crypto' ? 'crypto_markets' : 'prediction_markets',
        bot_id: String(toWrite.market_type) === 'crypto' ? 'crypto-research-bot-1' : 'research-bot-1',
      });
      console.log(`[RQS] mechanism_clarity low (${mc}) — seeding mechanism validation`);
    }
  } catch {}

  return written;
}

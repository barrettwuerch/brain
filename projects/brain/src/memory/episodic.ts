import 'dotenv/config';

import type { Episode } from '../types';

import { embed } from '../lib/embeddings';
import { supabase, supabaseAdmin } from '../lib/supabase';

export interface EpisodicWriteInput {
  episode: Episode;
  embedding: number[];
}

export interface EpisodicReadInput {
  task_type: string;
  task_input: Record<string, any>;
  limit?: number;
}

export async function writeEpisode(input: EpisodicWriteInput): Promise<{ id: string }> {
  // PostgREST + pgvector: represent vector as string like '[1,2,3]'
  const embedding = `[${input.embedding.join(',')}]`;

  const row: any = {
    task_id: input.episode.task_id,
    task_type: input.episode.task_type,
    task_input: input.episode.task_input,

    // Optional trading-desk scoping
    agent_role: input.episode.agent_role ?? null,
    desk: input.episode.desk ?? null,
    bot_id: input.episode.bot_id ?? null,

    reasoning: input.episode.reasoning,
    action_taken: input.episode.action_taken,
    observation: input.episode.observation,
    reflection: input.episode.reflection,
    lessons: input.episode.lessons ?? [],
    outcome: input.episode.outcome,
    outcome_score: input.episode.outcome_score,
    reasoning_score: input.episode.reasoning_score,
    error_type: input.episode.error_type,
    ttl_days: input.episode.ttl_days,

    embedding,
  };

  const { data, error } = await supabaseAdmin
    .from('episodes')
    .insert(row)
    .select('id')
    .single();

  if (error) throw error;

  // Phase 6: warm-up decrement (behavioral state machine)
  if (input.episode.bot_id) {
    const { decrementWarmUpAfterEpisode } = await import('../behavioral/state_manager');
    await decrementWarmUpAfterEpisode(input.episode.bot_id);
  }

  return { id: String((data as any)?.id) };
}

export async function readSimilarEpisodes(input: EpisodicReadInput): Promise<Episode[]> {
  // Vector similarity search via RPC.
  const queryText = `${input.task_type}\n${JSON.stringify(input.task_input)}`;
  const vec = await embed(queryText);
  const query_embedding = `[${vec.join(',')}]`;

  const { data, error } = await supabase
    .rpc('match_episodes', { query_embedding, match_count: input.limit ?? 5 });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: String(r.id),
    created_at: String(r.created_at),
    task_id: null,
    task_type: String(r.task_type),
    task_input: input.task_input,

    agent_role: null,
    desk: null,
    bot_id: null,

    reasoning: String(r.reasoning ?? ''),
    action_taken: (r.action_taken ?? {}) as Record<string, any>,
    observation: (r.observation ?? {}) as Record<string, any>,
    reflection: String(r.reflection ?? ''),
    lessons: [],

    outcome: (r.outcome ?? 'partial'),
    outcome_score: Number(r.outcome_score ?? 0),
    reasoning_score: Number(r.reasoning_score ?? 0),
    error_type: null,
    ttl_days: 30,
    embedding: null,
  })) as Episode[];
}

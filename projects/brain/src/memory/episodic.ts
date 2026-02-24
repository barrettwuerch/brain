// Episodic memory layer — stubs

import type { Episode } from '../types';

import { embed } from '../lib/embeddings';
import { supabaseAdmin } from '../lib/supabase';

export interface EpisodicWriteInput {
  episode: Episode;
}

export interface EpisodicReadInput {
  task_type: string;
  task_input: Record<string, any>;
  limit?: number;
}

export async function writeEpisode(_input: EpisodicWriteInput): Promise<void> {
  // Phase 3+ store is implemented in loop.ts store().
  // Keep this stub for future refactor when we centralize episode writes here.
}

export async function readSimilarEpisodes(input: EpisodicReadInput): Promise<Episode[]> {
  // Phase 4 minimal: vector similarity search via RPC.
  const queryText = `${input.task_type}\n${JSON.stringify(input.task_input)}`;
  const vec = await embed(queryText);
  const query_embedding = `[${vec.join(',')}]`;

  const { data, error } = await supabaseAdmin
    .rpc('match_episodes', { query_embedding, match_count: input.limit ?? 5 });

  if (error) throw error;

  // Map partial rows to Episode-ish shape (fields we return from RPC)
  return (data ?? []).map((r: any) => ({
    id: String(r.id),
    created_at: String(r.created_at),
    task_id: null,
    task_type: String(r.task_type),
    task_input: input.task_input,
    reasoning: '',
    action_taken: {},
    observation: {},
    reflection: String(r.reflection ?? ''),
    outcome: (r.outcome ?? 'partial'),
    outcome_score: Number(r.outcome_score ?? 0),
    reasoning_score: Number(r.reasoning_score ?? 0),
    error_type: null,
    ttl_days: 30,
    embedding: null,
  })) as Episode[];
}

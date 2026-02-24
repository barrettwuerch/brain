// Episodic memory layer — stubs

import type { Episode } from '../types';

export interface EpisodicWriteInput {
  episode: Episode;
}

export interface EpisodicReadInput {
  task_type: string;
  task_input: Record<string, any>;
  limit?: number;
}

export async function writeEpisode(_input: EpisodicWriteInput): Promise<void> {
  // TODO: write episode to persistent store (Supabase)
}

export async function readSimilarEpisodes(_input: EpisodicReadInput): Promise<Episode[]> {
  // TODO: vector similarity + recency + importance weighting
  return [];
}

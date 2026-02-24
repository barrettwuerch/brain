// Semantic memory layer

import type { SemanticFact } from '../types';

import { supabase } from '../lib/supabase';

export interface SemanticWriteInput {
  facts: SemanticFact[];
}

export interface SemanticReadInput {
  domain: string;
  limit?: number;
}

export async function writeSemanticFacts(_input: SemanticWriteInput): Promise<void> {
  // TODO: upsert facts, update confidence/confirm/violate counts
}

export async function readSemanticFacts(input: SemanticReadInput): Promise<SemanticFact[]> {
  const { data, error } = await supabase
    .from('semantic_facts')
    .select('*')
    .eq('domain', input.domain)
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .order('last_updated', { ascending: false })
    .limit(input.limit ?? 10);

  if (error) throw error;
  return (data ?? []) as any;
}

// Semantic memory layer — stubs

import type { SemanticFact } from '../types';

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

export async function readSemanticFacts(_input: SemanticReadInput): Promise<SemanticFact[]> {
  // TODO: fetch active facts by domain ordered by confidence/recency
  return [];
}

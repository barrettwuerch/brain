// Semantic memory layer

import type { SemanticFact } from '../types';

import { supabase, supabaseAdmin } from '../lib/supabase';

export interface SemanticWriteInput {
  facts: SemanticFact[];
}

export interface SemanticReadInput {
  domain: string;
  limit?: number;
}

export async function writeSemanticFacts(input: SemanticWriteInput): Promise<void> {
  for (const fact of input.facts ?? []) {
    const domain = String((fact as any).domain ?? '').trim();
    const text = String((fact as any).fact ?? '').trim();
    if (!domain || !text) continue;

    // semantic_facts does not have a unique constraint on (domain,fact), so we do a manual upsert.
    const { data: existing, error: rErr } = await supabaseAdmin
      .from('semantic_facts')
      .select('id,times_confirmed,times_violated')
      .eq('domain', domain)
      .eq('fact', text)
      .limit(1)
      .maybeSingle();
    if (rErr) throw rErr;

    const payload: any = {
      domain,
      fact: text,
      // Optional columns in newer migrations:
      fact_type: (fact as any).fact_type ?? undefined,
      confidence: Number((fact as any).confidence ?? 0.6),
      status: 'active',
      last_updated: new Date().toISOString(),
      supporting_episode_ids: (fact as any).supporting_episode_ids ?? [],
    };

    if (existing?.id) {
      // Increment confirm/violate counters if present on the incoming fact; otherwise preserve.
      const tc = Number((fact as any).times_confirmed ?? (existing as any).times_confirmed ?? 0);
      const tv = Number((fact as any).times_violated ?? (existing as any).times_violated ?? 0);

      const { error: uErr } = await supabaseAdmin
        .from('semantic_facts')
        .update({ ...payload, times_confirmed: tc, times_violated: tv })
        .eq('id', (existing as any).id);
      if (uErr) throw uErr;
    } else {
      const { error: iErr } = await supabaseAdmin.from('semantic_facts').insert(payload);
      if (iErr) throw iErr;
    }
  }
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

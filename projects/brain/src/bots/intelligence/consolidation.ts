import 'dotenv/config';

import type { Episode, SemanticFact } from '../../types';

import { embed } from '../../lib/embeddings';
import { supabaseAdmin } from '../../lib/supabase';

function nowIso() {
  return new Date().toISOString();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    ma += x * x;
    mb += y * y;
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  if (denom === 0) return 0;
  return dot / denom;
}

function topLessons(episodes: Episode[], topN: number = 3): string[] {
  const counts = new Map<string, number>();
  for (const e of episodes) {
    const lessons = (e as any)?.lessons;
    if (!Array.isArray(lessons)) continue;
    for (const l of lessons) {
      const s = String(l ?? '').trim();
      if (!s) continue;
      // ignore finding_id tags; those are links, not facts
      if (s.startsWith('finding_id:')) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k);
}

async function getActiveFactsForDesk(desk: string): Promise<SemanticFact[]> {
  const { data, error } = await supabaseAdmin
    .from('semantic_facts')
    .select('*')
    .eq('domain', desk)
    .eq('status', 'active')
    .order('last_updated', { ascending: false });

  if (error) throw error;
  return (data ?? []) as any;
}

async function incrementConfirmation(id: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('semantic_facts')
    .select('times_confirmed')
    .eq('id', id)
    .single();
  if (error) throw error;

  const times_confirmed = Number((data as any)?.times_confirmed ?? 0) + 1;

  const { error: updErr } = await supabaseAdmin
    .from('semantic_facts')
    .update({ times_confirmed, last_updated: nowIso() })
    .eq('id', id);
  if (updErr) throw updErr;
}

async function insertFact(params: {
  desk: string;
  fact: string;
  supporting_episode_ids: string[];
}): Promise<void> {
  const row = {
    domain: params.desk,
    fact: params.fact,
    supporting_episode_ids: params.supporting_episode_ids,
    confidence: 0.6,
    times_confirmed: 1,
    times_violated: 0,
    status: 'active',
  };

  const { error } = await supabaseAdmin.from('semantic_facts').insert(row);
  if (error) throw error;
}

export async function extractAndStoreFacts(
  episodes: Episode[],
  desk: string,
): Promise<{ stored: number; updated: number; skipped: number }> {
  const byType = new Map<string, Episode[]>();
  for (const e of episodes) {
    const t = String(e.task_type);
    const arr = byType.get(t) ?? [];
    arr.push(e);
    byType.set(t, arr);
  }

  const existing = await getActiveFactsForDesk(desk);
  // Precompute embeddings for existing facts (on-the-fly; semantic_facts table does not store embeddings yet)
  const existingEmbeddings: { id: string; vec: number[]; fact: string }[] = [];
  for (const f of existing) {
    const vec = await embed(String((f as any).fact ?? ''));
    existingEmbeddings.push({ id: String((f as any).id), vec, fact: String((f as any).fact ?? '') });
  }

  let stored = 0;
  let updated = 0;
  let skipped = 0;

  for (const [task_type, eps] of byType.entries()) {
    if (eps.length < 3) {
      skipped++;
      continue;
    }

    const lessons = topLessons(eps, 3);
    if (!lessons.length) {
      skipped++;
      continue;
    }

    const candidate = `desk=${desk} task_type=${task_type} | lessons: ${lessons.join(' | ')}`;
    const candVec = await embed(candidate);

    // find nearest
    let best: { id: string; sim: number } | null = null;
    for (const ex of existingEmbeddings) {
      const sim = cosineSimilarity(candVec, ex.vec);
      if (!best || sim > best.sim) best = { id: ex.id, sim };
    }

    if (best && best.sim > 0.85) {
      await incrementConfirmation(best.id);
      updated++;
    } else {
      await insertFact({
        desk,
        fact: candidate,
        supporting_episode_ids: eps.map((e) => String(e.id)).filter(Boolean),
      });
      stored++;
    }
  }

  return { stored, updated, skipped };
}

export async function pruneExpiredEpisodes(): Promise<number> {
  // correct > 30 days
  const { data: d1, error: e1 } = await supabaseAdmin
    .from('episodes')
    .delete()
    .eq('outcome', 'correct')
    .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .select('id');
  if (e1) throw e1;

  // incorrect > 60 days
  const { data: d2, error: e2 } = await supabaseAdmin
    .from('episodes')
    .delete()
    .eq('outcome', 'incorrect')
    .lt('created_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
    .select('id');
  if (e2) throw e2;

  return (d1?.length ?? 0) + (d2?.length ?? 0);
}

export async function retireWeakFacts(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('semantic_facts')
    .update({ status: 'retired', last_updated: nowIso() })
    .lt('confidence', 0.3)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

export async function countPrunableEpisodes(): Promise<number> {
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const { count: c1, error: e1 } = await supabaseAdmin
    .from('episodes')
    .select('id', { head: true, count: 'exact' })
    .eq('outcome', 'correct')
    .lt('created_at', cutoff30);
  if (e1) throw e1;

  const { count: c2, error: e2 } = await supabaseAdmin
    .from('episodes')
    .select('id', { head: true, count: 'exact' })
    .eq('outcome', 'incorrect')
    .lt('created_at', cutoff60);
  if (e2) throw e2;

  return (c1 ?? 0) + (c2 ?? 0);
}

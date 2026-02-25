import 'dotenv/config';

import type { ConsolidationReport, Episode } from '../../types';

import { supabaseAdmin } from '../../lib/supabase';

function startOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

function mostCommonLessonThemes(episodes: Episode[], topN: number = 3): string[] {
  const counts = new Map<string, number>();
  for (const e of episodes) {
    const lessons = (e as any)?.lessons;
    if (!Array.isArray(lessons)) continue;
    for (const l of lessons) {
      const s = String(l ?? '').trim();
      if (!s) continue;
      if (s.startsWith('finding_id:')) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k);
}

async function extractSuccessFacts(episodes: Episode[]): Promise<{ stored: number; updated: number; skipped: number }> {
  // Filter to last 24h correct episodes
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = episodes.filter((e) => {
    const t = new Date(String(e.created_at)).getTime();
    return Number.isFinite(t) && t >= cutoff.getTime() && e.outcome === 'correct';
  });

  // Group by task_type
  const byType = new Map<string, Episode[]>();
  for (const e of recent) {
    const t = String(e.task_type);
    const arr = byType.get(t) ?? [];
    arr.push(e);
    byType.set(t, arr);
  }

  let stored = 0;
  let updated = 0;
  let skipped = 0;

  for (const [task_type, eps] of byType.entries()) {
    if (eps.length < 3) {
      skipped++;
      continue;
    }

    const themes = mostCommonLessonThemes(eps, 3);
    const fact = `task_type=${task_type} | lessons: ${themes.join(' | ')}`;

    // Duplicate check by exact content match (upgrade to embedding similarity when OpenAI key is live)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('semantic_facts')
      .select('id,times_confirmed')
      .eq('fact', fact)
      .eq('status', 'active')
      .eq('fact_type', 'success_pattern')
      .limit(1)
      .maybeSingle();
    if (exErr) throw exErr;

    if (existing?.id) {
      const times_confirmed = Number((existing as any).times_confirmed ?? 0) + 1;

      const existingFact = String((existing as any).fact ?? fact);
      const isProvisional = existingFact.startsWith('[PROVISIONAL');

      // Promote provisional facts after 3 confirmations.
      let nextFact = existingFact;
      let nextConf: number | undefined = undefined;

      const violatesCapitalPreservation = (text: string) => {
        const t = text.toLowerCase();
        if (t.includes('bypass') && t.includes('circuit')) return true;
        if (t.includes('ignore') && t.includes('circuit')) return true;
        if (t.includes('max_drawdown') && (t.includes('>') || t.includes('20%') || t.includes('0.2'))) return true;
        if (t.includes('kelly') && (t.includes('2.0x') || t.includes('full kelly'))) return true;
        return false;
      };

      if (isProvisional && violatesCapitalPreservation(existingFact)) {
        // Immediate retire on capital preservation violations (do not wait for repeated contradictions).
        await supabaseAdmin
          .from('semantic_facts')
          .update({ status: 'retired', last_updated: new Date().toISOString() })
          .eq('id', existing.id);
        console.log('[CROSS-DESK] Provisional fact violates capital preservation — retired immediately');
        updated++;
        continue;
      }

      if (isProvisional && times_confirmed >= 3) {
        nextFact = existingFact.replace(/^\[PROVISIONAL[^\]]*\]\s*/i, '');
        nextConf = Math.min(Number((existing as any).confidence ?? 0.6) / 0.6, 0.95);
        console.log('[CROSS-DESK] Provisional fact confirmed — promoted to full confidence');
      }

      const { error: updErr } = await supabaseAdmin
        .from('semantic_facts')
        .update({ times_confirmed, last_updated: new Date().toISOString(), fact: nextFact, ...(nextConf !== undefined ? { confidence: nextConf } : {}) })
        .eq('id', existing.id);
      if (updErr) throw updErr;
      updated++;
      continue;
    }

    const row = {
      domain: 'prediction_markets',
      fact,
      fact_type: 'success_pattern',
      supporting_episode_ids: eps.map((e) => String(e.id)).filter(Boolean),
      confidence: 0.6,
      times_confirmed: 1,
      times_violated: 0,
      status: 'active',
    };

    const { error } = await supabaseAdmin.from('semantic_facts').insert(row);
    if (error) throw error;

    // FIX H: provisional cross-desk distribution (reduced confidence).
    const violatesCapitalPreservation = (text: string) => {
      const t = text.toLowerCase();
      if (t.includes('bypass') && t.includes('circuit')) return true;
      if (t.includes('ignore') && t.includes('circuit')) return true;
      if (t.includes('max_drawdown') && (t.includes('>') || t.includes('20%') || t.includes('0.2'))) return true;
      if (t.includes('kelly') && (t.includes('2.0x') || t.includes('full kelly'))) return true;
      return false;
    };

    const provisional = {
      ...row,
      domain: 'crypto',
      fact: `[PROVISIONAL from ${row.domain}] ${row.fact}`,
      confidence: Math.min(row.confidence * 0.6, 0.95),
      times_confirmed: 0,
      times_violated: 0,
      status: violatesCapitalPreservation(row.fact) ? 'retired' : 'active',
    };

    if (provisional.status === 'retired') {
      console.log('[CROSS-DESK] Provisional fact violates capital preservation — retired immediately');
    }

    await supabaseAdmin.from('semantic_facts').insert(provisional);

    stored++;
  }

  return { stored, updated, skipped };
}

async function extractFailureFacts(episodes: Episode[]): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = episodes.filter((e) => {
    const t = new Date(String(e.created_at)).getTime();
    return Number.isFinite(t) && t >= cutoff.getTime() && e.outcome === 'incorrect';
  });

  // Group by error_type + task_type
  const groups = new Map<string, Episode[]>();
  for (const e of recent) {
    const et = String((e as any).error_type ?? 'unknown');
    const key = `${String(e.task_type)}::${et}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  let stored = 0;

  for (const [key, eps] of groups.entries()) {
    if (eps.length < 1) continue;
    const [task_type, error_type] = key.split('::');

    const refl = String((eps[0] as any).reflection ?? '').slice(0, 240);
    const content = `[FAILURE PATTERN] task_type=${task_type} error_type=${error_type}: ${refl}`;

    // Guard: only store meaningful failure patterns (avoid noise from manual DB edits / inconsistent states)
    if (!refl || refl.toLowerCase().includes('produced the expected result')) continue;

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('semantic_facts')
      .select('id,times_confirmed,confidence')
      .eq('fact', content)
      .eq('status', 'active')
      .eq('fact_type', 'failure_pattern')
      .limit(1)
      .maybeSingle();
    if (exErr) throw exErr;

    if (existing?.id) {
      const times_confirmed = Number((existing as any).times_confirmed ?? 0) + 1;
      const confidence = Math.min(Number((existing as any).confidence ?? 0.7) + 0.05, 0.95);
      const { error: updErr } = await supabaseAdmin
        .from('semantic_facts')
        .update({ times_confirmed, confidence, last_updated: new Date().toISOString() })
        .eq('id', existing.id);
      if (updErr) throw updErr;
      continue;
    }

    const row = {
      domain: String(task_type),
      fact: content,
      fact_type: 'failure_pattern',
      supporting_episode_ids: eps.map((e) => String(e.id)).filter(Boolean),
      confidence: 0.7,
      times_confirmed: 1,
      times_violated: 0,
      status: 'active',
    };

    const { error } = await supabaseAdmin.from('semantic_facts').insert(row);
    if (error) throw error;

    stored++;
  }

  return stored;
}

export async function extractAndStoreFacts(episodes: Episode[]): Promise<{ successCount: number; failureCount: number }> {
  const success = await extractSuccessFacts(episodes);
  const failureCount = await extractFailureFacts(episodes);
  return { successCount: success.stored, failureCount };
}

export async function pruneExpiredMemories(): Promise<{ episodesPruned: number; factsRetired: number }> {
  // Episodes: delete where created_at < NOW() - ttl_days
  const maxDays = 90;
  const cutoff = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: old, error: oldErr } = await supabaseAdmin
    .from('episodes')
    .select('id,created_at,ttl_days')
    .lt('created_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(5000);
  if (oldErr) throw oldErr;

  const now = Date.now();
  const toDelete: string[] = [];
  for (const r of old ?? []) {
    const created = new Date(String((r as any).created_at)).getTime();
    const ttl = Number((r as any).ttl_days ?? 0);
    if (!Number.isFinite(created) || !Number.isFinite(ttl) || ttl <= 0) continue;
    const ageDays = (now - created) / (24 * 60 * 60 * 1000);
    if (ageDays > ttl) toDelete.push(String((r as any).id));
  }

  let episodesPruned = 0;
  if (toDelete.length) {
    const { data: del, error: delErr } = await supabaseAdmin.from('episodes').delete().in('id', toDelete).select('id');
    if (delErr) throw delErr;
    episodesPruned = del?.length ?? 0;
  }

  // Semantic facts: retire if confidence low OR violation ratio too high
  const { data: facts, error: factsErr } = await supabaseAdmin
    .from('semantic_facts')
    .select('id,confidence,times_confirmed,times_violated,status')
    .eq('status', 'active')
    .limit(5000);
  if (factsErr) throw factsErr;

  const retireIds: string[] = [];
  for (const f of facts ?? []) {
    const conf = Number((f as any).confidence ?? 0);
    const tc = Number((f as any).times_confirmed ?? 0);
    const tv = Number((f as any).times_violated ?? 0);
    const ratio = tc > 0 ? tv / tc : 0;
    if (conf < 0.3 || ratio > 0.4) retireIds.push(String((f as any).id));
  }

  let factsRetired = 0;
  if (retireIds.length) {
    const { data: upd, error: updErr } = await supabaseAdmin
      .from('semantic_facts')
      .update({ status: 'retired', last_updated: new Date().toISOString() })
      .in('id', retireIds)
      .select('id');
    if (updErr) throw updErr;
    factsRetired = upd?.length ?? 0;
  }

  return { episodesPruned, factsRetired };
}

export function buildConsolidationReport(
  episodesRead: number,
  factsExtracted: number,
  factsUpdated: number,
  factsRetired: number,
  episodesPruned: number,
): ConsolidationReport {
  return {
    date: new Date().toISOString().slice(0, 10),
    episodes_read: episodesRead,
    facts_extracted: factsExtracted,
    facts_updated: factsUpdated,
    facts_retired: factsRetired,
    episodes_pruned: episodesPruned,
    cross_desk_learnings: 0,
    bots_evaluated: [],
  };
}

export async function getTodaysEpisodes(): Promise<Episode[]> {
  const now = new Date();
  const start = startOfDayUtc(now).toISOString();
  const { data, error } = await supabaseAdmin.from('episodes').select('*').gte('created_at', start);
  if (error) throw error;
  return (data ?? []) as any;
}

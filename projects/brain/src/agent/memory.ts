import 'dotenv/config';

import type { Episode } from '../types';

import { readSimilarEpisodes } from '../memory/episodic';
import { supabaseAdmin } from '../lib/supabase';

function parseRegime(text: string): 'low' | 'normal' | 'elevated' | 'extreme' | 'unknown' {
  const t = String(text ?? '').toLowerCase();
  if (t.includes('extreme')) return 'extreme';
  if (t.includes('elevated')) return 'elevated';
  if (t.includes('normal')) return 'normal';
  if (t.includes('low')) return 'low';
  return 'unknown';
}

export async function getCurrentVolRegime(): Promise<'low' | 'normal' | 'elevated' | 'extreme' | 'unknown'> {
  try {
    const { data } = await supabaseAdmin
      .from('semantic_facts')
      .select('fact,last_updated,domain')
      .in('domain', ['crypto', 'prediction_markets'])
      .order('last_updated', { ascending: false })
      .limit(10);

    const combined = (data ?? []).map((r: any) => String(r.fact ?? '')).join('\n');
    return parseRegime(combined);
  } catch {
    return 'unknown';
  }
}

export async function readSimilarEpisodesRegimeAware(args: {
  task_type: string;
  task_input: Record<string, any>;
  limit: number;
}): Promise<Episode[]> {
  const current = await getCurrentVolRegime();
  const eps = await readSimilarEpisodes({ task_type: args.task_type, task_input: args.task_input, limit: args.limit });

  const matched: Episode[] = [];
  const mismatched: Episode[] = [];

  for (const e of eps) {
    const ev = (e as any).vol_regime ?? 'unknown';
    const episodeRegime = parseRegime(ev);

    let prefix = '[REGIME: unknown]';
    if (episodeRegime !== 'unknown' && current !== 'unknown') {
      if (episodeRegime === current) prefix = `[REGIME MATCH: ${current}]`;
      else prefix = `[REGIME MISMATCH: episode=${episodeRegime} current=${current}]`;
    }

    const e2: Episode = { ...e, reflection: `${prefix}\n${e.reflection}` };

    if (prefix.startsWith('[REGIME MISMATCH')) mismatched.push(e2);
    else matched.push(e2);
  }

  return [...matched, ...mismatched];
}

// Convenience for the verification snippet: return episode context blocks as strings.
export async function retrieveSimilarEpisodes(query: string, limit: number): Promise<string[]> {
  const eps = await readSimilarEpisodesRegimeAware({ task_type: 'freeform_query', task_input: { query }, limit });
  return eps.map((e) => `${e.reflection}\nTASK=${e.task_type} OUTCOME=${e.outcome} SCORE=${e.outcome_score}`);
}

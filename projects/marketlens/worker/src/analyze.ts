/**
 * analyze.ts
 *
 * Phase 1 analyze loop:
 * 1) Query stories where is_processed=false ORDER BY published_at DESC LIMIT 20
 * 2) Cluster by coarse category
 * 3) For each cluster, call Claude to generate an Insight JSON
 * 4) Insert into insights
 * 5) Mark stories processed
 */

import { supabase } from './lib/supabase.js';
import { claudeJson, extractFirstJsonObject } from './lib/anthropic.js';

type DbStory = {
  id: string;
  source: string;
  title: string;
  body: string | null;
  published_at: string | null;
  category: string | null;
};

type ClaudeInsight = {
  headline: string;
  thesis: string;
  sectors: string[];
  tickers: string[];
  direction: 'bullish' | 'bearish' | 'mixed' | 'neutral';
  conviction: 1 | 2 | 3 | 4 | 5;
  time_horizon: 'immediate' | 'short' | 'medium' | 'long';
  second_order: string[];
  risks: string[];
  educational_context: string;
};

function guessCategory(s: DbStory): string {
  const t = `${s.title}\n${s.body ?? ''}`.toLowerCase();
  if (/(supreme court|scotus|lawsuit|judge|ruling|appeal|sec |edgar|federal register|doj|ftc)/.test(t)) return 'legal';
  if (/(earnings|guidance|revenue|eps|quarter|q[1-4]|beats|misses)/.test(t)) return 'earnings';
  if (/(fed|rates|inflation|cpi|ppi|jobs report|unemployment|treasury|yield|tariff|ieepa)/.test(t)) return 'macro';
  if (/(war|ceasefire|sanctions|china|russia|ukraine|israel|iran|taiwan|missile)/.test(t)) return 'geopolitical';
  return s.category ?? 'other';
}

function mapDirection(d: ClaudeInsight['direction']): 'bullish' | 'bearish' | 'mixed' | 'unclear' {
  if (d === 'neutral') return 'unclear';
  return d;
}

function mapHorizon(h: ClaudeInsight['time_horizon']): 'days' | 'weeks' | 'months' | 'quarters' | 'years' {
  switch (h) {
    case 'immediate': return 'days';
    case 'short': return 'weeks';
    case 'medium': return 'months';
    case 'long': return 'quarters';
    default: return 'weeks';
  }
}

const SYSTEM_PROMPT =
  "You are a senior investment analyst. Given one or more news stories, identify the investment implications a sophisticated retail investor might miss. Focus on second-order effects, not just the obvious first-order reaction. Return ONLY valid JSON matching this schema — no markdown, no explanation: { headline: string, thesis: string, sectors: string[], tickers: string[], direction: 'bullish' | 'bearish' | 'mixed' | 'neutral', conviction: 1 | 2 | 3 | 4 | 5, time_horizon: 'immediate' | 'short' | 'medium' | 'long', second_order: string[], risks: string[], educational_context: string }";

function cluster(stories: DbStory[]) {
  const m = new Map<string, DbStory[]>();
  for (const s of stories) {
    const cat = guessCategory(s);
    const key = cat;
    const arr = m.get(key) ?? [];
    arr.push(s);
    m.set(key, arr);
  }
  return Array.from(m.entries()).map(([category, stories]) => ({ category, stories }));
}

function buildUserMessage(stories: DbStory[]) {
  const blocks = stories.map((s) => {
    const summary = (s.body ?? '').slice(0, 500);
    return `TITLE: ${s.title}\nSOURCE: ${s.source}\nSUMMARY: ${summary}`;
  });
  return `Analyze these stories and return investment insight JSON:\n\n${blocks.join('\n---\n')}`;
}

async function main() {
  const { data, error } = await supabase
    .from('stories')
    .select('id,source,title,body,published_at,category')
    .eq('is_processed', false)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(20);

  if (error) throw error;
  const stories = (data ?? []) as DbStory[];
  console.log(`Fetched ${stories.length} unprocessed stories`);
  if (!stories.length) return;

  const clusters = cluster(stories);
  console.log(`Clusters: ${clusters.map((c) => `${c.category}:${c.stories.length}`).join(' | ')}`);

  for (const c of clusters) {
    if (!c.stories.length) continue;

    const user = buildUserMessage(c.stories);
    let parsed: ClaudeInsight;

    try {
      const raw = await claudeJson({ system: SYSTEM_PROMPT, user });
      parsed = extractFirstJsonObject(raw) as ClaudeInsight;
    } catch (e: any) {
      console.error('Claude parse/analyze failed for cluster', c.category, e?.message ?? e);
      continue;
    }

    // Insert insight
    const story_ids = c.stories.map((s) => s.id);
    const insertRow = {
      story_ids,
      headline: String(parsed.headline ?? '').trim(),
      thesis: String(parsed.thesis ?? '').trim(),
      sectors: Array.isArray(parsed.sectors) ? parsed.sectors : [],
      tickers: Array.isArray(parsed.tickers) ? parsed.tickers : [],
      direction: mapDirection(parsed.direction),
      conviction: Number(parsed.conviction),
      time_horizon: mapHorizon(parsed.time_horizon),
      second_order: Array.isArray(parsed.second_order) ? parsed.second_order : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      educational_context: String(parsed.educational_context ?? '').trim() || null,
    };

    if (!insertRow.headline || !insertRow.thesis) {
      console.error('Skipping insert: missing headline/thesis');
      continue;
    }

    const { error: insErr, data: insData } = await supabase
      .from('insights')
      .insert(insertRow)
      .select('id')
      .single();

    if (insErr) {
      console.error('Insert insight failed', insErr);
      continue;
    }

    console.log(`Inserted insight ${insData?.id} for cluster ${c.category} stories=${story_ids.length}`);

    // Mark stories processed
    const { error: updErr } = await supabase
      .from('stories')
      .update({ is_processed: true })
      .in('id', story_ids);

    if (updErr) {
      console.error('Failed to mark stories processed', updErr);
      // (We keep the insight; can reconcile later)
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};

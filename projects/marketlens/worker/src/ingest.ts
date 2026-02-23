/**
 * ingest.ts
 *
 * Phase 1: pull a small set of RSS feeds, normalize, and upsert into Supabase `stories`.
 *
 * Usage:
 *   cd worker
 *   cp .env.example .env   # fill secrets
 *   npm run dev:ingest
 */

import crypto from 'node:crypto';
import Parser from 'rss-parser';

import { supabase } from './lib/supabase.js';

type FeedSource = { source: string; url: string; category?: string };

const FEEDS: FeedSource[] = [
  { source: 'yahoo_finance', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline', category: 'macro' },
  { source: 'marketwatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories', category: 'macro' },
  { source: 'reuters_business', url: 'https://feeds.reuters.com/reuters/businessNews', category: 'macro' },
  { source: 'scotusblog', url: 'https://www.scotusblog.com/feed', category: 'legal' },
  { source: 'wsj_us_business', url: 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml', category: 'macro' }
];

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function toIso(x: any): string | null {
  if (!x) return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normText(s: any): string {
  return String(s ?? '').trim();
}

async function upsertStories(rows: any[]) {
  if (!rows.length) return { inserted: 0 };

  // Upsert on url (unique index exists)
  const { error } = await supabase
    .from('stories')
    .upsert(rows, { onConflict: 'url', ignoreDuplicates: false });

  if (error) throw error;
  return { upserted: rows.length };
}

async function main() {
  const parser = new Parser({ timeout: 20_000 });

  let totalItems = 0;
  let totalUpsert = 0;

  for (const f of FEEDS) {
    console.log(`Fetching: ${f.source} ${f.url}`);
    const feed = await parser.parseURL(f.url);
    const items = feed.items ?? [];
    totalItems += items.length;

    const rows = items
      .map((it) => {
        const url = normText(it.link || (it as any).guid);
        const title = normText(it.title);
        const body = normText((it as any).contentSnippet || (it as any).content || (it as any).summary);
        if (!url || !title) return null;

        const published_at = toIso((it as any).isoDate || (it as any).pubDate);

        const contentHash = sha256(`${title}\n${body}`);
        const urlHash = sha256(url);

        return {
          source: f.source,
          url,
          title,
          body: body || null,
          published_at,
          category: f.category ?? null,
          is_processed: false,
          url_hash: urlHash,
          content_hash: contentHash
        };
      })
      .filter(Boolean);

    const res = await upsertStories(rows);
    const upserted = res.upserted ?? 0;
    totalUpsert += upserted;
    console.log(`  items=${items.length} upserted=${upserted}`);
  }

  console.log(`Done. totalItems=${totalItems} totalUpserted=${totalUpsert}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};

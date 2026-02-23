/**
 * ingest.ts (skeleton)
 *
 * Phase 1: pull a small set of RSS feeds, normalize to Story, and upsert into Supabase.
 */

import crypto from 'node:crypto';

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function main() {
  // TODO: load env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or worker key)
  // TODO: fetch RSS feeds
  // TODO: normalize items into stories
  // TODO: compute url_hash/content_hash
  // TODO: upsert into `stories` and set is_processed=false

  console.log('ingest: not implemented');
  console.log('sha256 sanity:', sha256('marketlens'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};

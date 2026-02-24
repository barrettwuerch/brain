import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { extractAndStoreFacts, pruneExpiredMemories } from '../bots/intelligence/consolidation';
import { attributePerformance } from '../bots/intelligence/attribution';
import { generateFullDailyReport } from '../bots/intelligence/report_generator';

async function main() {
  console.log('=== NIGHTLY INTELLIGENCE RUN ===');

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: episodes, error } = await supabaseAdmin.from('episodes').select('*').gte('created_at', cutoff);
  if (error) throw error;

  const factsStored = await extractAndStoreFacts((episodes ?? []) as any);
  console.log('facts_stored', factsStored);

  const pruned = await pruneExpiredMemories();
  console.log('prune', pruned);

  const attribution = await attributePerformance();
  console.log('attribution_warnings', attribution.warnings);

  await generateFullDailyReport();

  console.log('=== DONE ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

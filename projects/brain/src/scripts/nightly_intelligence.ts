import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { attributePerformance } from '../bots/intelligence/attribution';
import { extractAndStoreFacts, pruneExpiredEpisodes, retireWeakFacts } from '../bots/intelligence/consolidation';
import { generateFullDailyReport } from '../bots/intelligence/report_generator';

function startOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

async function main() {
  const pruned = await pruneExpiredEpisodes();
  console.log('pruned_episodes', pruned);

  const retired = await retireWeakFacts();
  console.log('retired_facts', retired);

  const now = new Date();
  const todayStart = startOfDayUtc(now);

  const { data: todayEpisodes, error } = await supabaseAdmin
    .from('episodes')
    .select('*')
    .gte('created_at', todayStart.toISOString());
  if (error) throw error;

  const facts = await extractAndStoreFacts((todayEpisodes ?? []) as any, 'prediction_markets');
  console.log('consolidation', facts);

  const attr = await attributePerformance(7);
  console.log('attribution_summary', { highlights: attr.highlights, warnings: attr.warnings });

  await generateFullDailyReport();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const { data, error, count } = await supabaseAdmin
    .from('episodes')
    .select('id,embedding,outcome,outcome_score,reasoning_score,reflection', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;

  console.log('episodes_count', count);
  console.log(
    'latest',
    (data ?? []).map((r: any) => ({
      id: r.id,
      hasEmbedding: !!r.embedding,
      outcome: r.outcome,
      os: r.outcome_score,
      rs: r.reasoning_score,
      reflLen: (r.reflection || '').length,
    })),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

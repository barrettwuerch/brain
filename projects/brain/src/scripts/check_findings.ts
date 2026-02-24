import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const { data, error } = await supabaseAdmin
    .from('research_findings')
    .select('id,created_at,finding_type,edge_type,rqs_score,status,recommendation')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  console.log('research_findings (latest 10)');
  for (const r of data ?? []) {
    console.log({
      id: (r as any).id,
      finding_type: (r as any).finding_type,
      edge_type: (r as any).edge_type,
      rqs_score: (r as any).rqs_score,
      status: (r as any).status,
      recommendation: (r as any).recommendation,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

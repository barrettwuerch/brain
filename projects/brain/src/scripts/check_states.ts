import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const { data, error } = await supabaseAdmin
    .from('bot_states')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  console.log('bot_states');
  for (const r of data ?? []) {
    console.log({
      bot_id: (r as any).bot_id,
      agent_role: (r as any).agent_role,
      desk: (r as any).desk,
      current_state: (r as any).current_state,
      warm_up: (r as any).warm_up,
      warm_up_episodes_remaining: (r as any).warm_up_episodes_remaining,
      requires_manual_review: (r as any).requires_manual_review,
      updated_at: (r as any).updated_at,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

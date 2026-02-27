import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function run() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await sb
    .from('watch_conditions')
    .update({
      max_triggers_per_day: 48,
      cooldown_minutes: 30,
      last_triggered: null,
    })
    .eq('market_type', 'crypto')
    .eq('status', 'active');
  console.log(error ?? 'Updated: 48 triggers/day, 30min cooldown, cooldown cleared');
}

run().catch(console.error);

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function run() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  const { data: positions } = await sb.from('positions').select('*').is('closed_at', null);
  console.log('Open positions:', positions?.length ?? 0);
  console.table(positions?.map(p => ({ symbol: (p as any).symbol ?? (p as any).ticker, entry: (p as any).entry_price, stop: (p as any).stop_level, target: (p as any).profit_target, created: (p as any).created_at })));

  const { data: sellConditions } = await sb.from('watch_conditions').select('*').eq('status', 'active').eq('action_type', 'place_limit_order').not('action_params->side', 'eq', 'buy');
  console.log('\nSell-side watch conditions:', sellConditions?.length ?? 0);
}

run().catch(console.error);

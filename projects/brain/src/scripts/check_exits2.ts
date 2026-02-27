import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Episodes for place_limit_order or place_crypto_limit_order since reset
  const { data: trades } = await sb.from('episodes')
    .select('id,task_type,action_taken,outcome,created_at,bot_id')
    .in('task_type', ['place_limit_order', 'place_crypto_limit_order', 'size_position'])
    .gte('created_at', '2026-02-27T06:27:00Z')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('Trade episodes since reset:', JSON.stringify(trades, null, 2));

  // Check the openPosition code path — look for position rows created after reset
  const { data: newPos } = await sb.from('positions')
    .select('*')
    .gte('created_at', '2026-02-27T06:27:00Z');
  console.log('New positions since reset:', JSON.stringify(newPos, null, 2));

  // Check Alpaca env vars are present
  console.log('ALPACA_KEY set:', !!process.env.ALPACA_KEY);
  console.log('ALPACA_SECRET set:', !!process.env.ALPACA_SECRET);
  console.log('ALPACA_KEY prefix:', process.env.ALPACA_KEY?.slice(0, 8));
}

main().catch(console.error);

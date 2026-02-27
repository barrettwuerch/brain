import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: manageTasks } = await sb.from('tasks')
    .select('id,task_type,task_input,status,created_at')
    .eq('task_type', 'manage_crypto_position')
    .gte('created_at', '2026-02-27T07:00:00Z')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('=== Recent manage tasks ===');
  console.log(JSON.stringify(manageTasks?.map((t: any) => ({
    status: t.status,
    symbol: t.task_input?.symbol,
    current_price: t.task_input?.current_price,
    stop: t.task_input?.stop_level,
    target: t.task_input?.profit_target,
    created_at: t.created_at,
  })), null, 2));

  const { data: stuck } = await sb.from('tasks')
    .select('id,task_type,status,created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('\n=== Stuck pending tasks ===');
  console.log(JSON.stringify(stuck, null, 2));

  const { data: breakers } = await sb.from('episodes')
    .select('id,task_type,action_taken,created_at')
    .eq('task_type', 'evaluate_circuit_breakers')
    .gte('created_at', '2026-02-27T07:00:00Z')
    .order('created_at', { ascending: false })
    .limit(3);
  console.log('\n=== Circuit breaker states ===');
  console.log(JSON.stringify(breakers?.map((b: any) => ({
    created_at: b.created_at,
    action: b.action_taken?.action,
    breached: b.action_taken?.breached,
    paused_bots: b.action_taken?.paused_bots,
  })), null, 2));

  const { data: botStates } = await sb.from('bot_states')
    .select('bot_id,current_state,updated_at')
    .order('updated_at', { ascending: false });
  console.log('\n=== Bot states ===');
  console.log(JSON.stringify(botStates, null, 2));

  const { data: openPos } = await sb.from('positions')
    .select('id,market_ticker,entry_price,size,stop_level,profit_target,created_at')
    .eq('status', 'open');
  console.log('\n=== Open positions ===');
  console.log(JSON.stringify(openPos, null, 2));
}

main().catch(console.error);

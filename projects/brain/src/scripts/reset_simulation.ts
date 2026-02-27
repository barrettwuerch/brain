import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function authHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  };
}

const BASE = (process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '');

async function run() {
  // 1. Cancel all open Alpaca orders
  console.log('Cancelling all Alpaca orders...');
  const cancelRes = await fetch(`${BASE}/v2/orders`, { method: 'DELETE', headers: authHeaders() });
  console.log('Orders cancelled:', cancelRes.status);

  // 2. Close all Alpaca positions
  console.log('Closing all Alpaca positions...');
  const closeRes = await fetch(`${BASE}/v2/positions`, { method: 'DELETE', headers: authHeaders() });
  console.log('Positions closed:', closeRes.status);

  // 3. Mark all Supabase positions as closed
  console.log('Closing Supabase positions...');
  const { error: posErr } = await sb.from('positions')
    .update({ closed_at: new Date().toISOString(), exit_reason: 'manual', status: 'closed' })
    .is('closed_at', null);
  console.log(posErr ? `ERROR: ${posErr.message}` : 'Supabase positions closed ✅');

  // 4. Cancel all pending/queued tasks
  console.log('Clearing task queue...');
  const { error: taskErr } = await sb.from('tasks')
    .update({ status: 'failed' })
    .in('status', ['queued', 'pending']);
  console.log(taskErr ? `ERROR: ${taskErr.message}` : 'Task queue cleared ✅');

  // 5. Reset simulation capital to $5000
  console.log('Resetting capital to $5000...');
  const { error: capErr } = await sb.from('operational_state')
    .upsert({ domain: 'simulation', key: 'simulation_capital_total', value: { amount: 5000 }, published_by: 'reset_script', ttl_seconds: 86400, expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() }, { onConflict: 'domain,key' });
  console.log(capErr ? `ERROR: ${capErr.message}` : 'Capital reset to $5000 ✅');

  // 6. Reset watch condition cooldowns
  console.log('Resetting scanner cooldowns...');
  const { error: wcErr } = await sb.from('watch_conditions')
    .update({ last_triggered: null })
    .eq('status', 'active');
  console.log(wcErr ? `ERROR: ${wcErr.message}` : 'Cooldowns reset ✅');

  console.log('\n🧹 Simulation reset complete. Fresh slate.');
}

run().catch(console.error);

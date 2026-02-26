import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { getAccount } from '../lib/alpaca';
import { getBalance } from '../lib/kalshi';

function ttlSeconds(days: number) {
  return days * 24 * 60 * 60;
}

function expiresAt(ttl_s: number) {
  return new Date(Date.now() + ttl_s * 1000).toISOString();
}

async function upsertOpState(args: { domain: string; key: string; value: any; ttl_s: number }) {
  const row = {
    domain: args.domain,
    key: args.key,
    value: args.value,
    published_by: 'simulation_baseline',
    published_at: new Date().toISOString(),
    ttl_seconds: args.ttl_s,
    expires_at: expiresAt(args.ttl_s),
  };

  const { error } = await supabaseAdmin.from('operational_state').upsert(row, { onConflict: 'domain,key' });
  if (error) throw error;
}

async function main() {
  console.log('Recording simulation baseline...');

  const account = await getAccount();
  const alpacaEquityActual = Number(account.equity);

  // Simulation capital caps (not the full paper account)
  const alpacaCapitalCap = 4000;
  const kalshiBalance = 1000;

  // (Optional sanity ping; not used for baseline math)
  try {
    await getBalance();
  } catch {
    // ignore
  }

  const { data: botStates, error: bsErr } = await supabaseAdmin
    .from('bot_states')
    .select('bot_id,current_state,desk,agent_role,current_drawdown,reason,updated_at');
  if (bsErr) throw bsErr;

  const baseline = {
    alpaca_equity_actual: alpacaEquityActual,
    alpaca_capital_cap: alpacaCapitalCap,
    kalshi_balance: kalshiBalance,
    total_capital: alpacaCapitalCap + kalshiBalance,
    bot_states_snapshot: botStates ?? [],
    recorded_at: new Date().toISOString(),
    simulation_day: 1,
  };

  const ttl_s = ttlSeconds(60); // keep baseline around for 60 days

  await upsertOpState({ domain: 'simulation', key: 'simulation_baseline', value: baseline, ttl_s });

  // Simulation capital split
  await upsertOpState({ domain: 'simulation', key: 'simulation_capital_kalshi', value: { amount: kalshiBalance }, ttl_s });
  await upsertOpState({ domain: 'simulation', key: 'simulation_capital_alpaca', value: { amount: alpacaCapitalCap }, ttl_s });
  await upsertOpState({ domain: 'simulation', key: 'simulation_capital_total', value: { amount: alpacaCapitalCap + kalshiBalance }, ttl_s });

  // Risk parameters
  await upsertOpState({ domain: 'simulation', key: 'risk_max_kelly_fraction', value: { value: 0.25 }, ttl_s });
  await upsertOpState({ domain: 'simulation', key: 'risk_circuit_breaker_threshold', value: { value: 0.15 }, ttl_s });
  await upsertOpState({ domain: 'simulation', key: 'risk_max_concurrent_positions', value: { value: 5 }, ttl_s });

  await upsertOpState({ domain: 'simulation', key: 'simulation_start_date', value: { date: new Date().toISOString() }, ttl_s });
  await upsertOpState({ domain: 'simulation', key: 'simulation_status', value: { status: 'running', day: 1 }, ttl_s });

  console.log('✅ Baseline recorded:');
  console.log(` Alpaca equity (actual paper): $${alpacaEquityActual.toFixed(2)}`);
  console.log(` Alpaca simulation cap: $${alpacaCapitalCap.toFixed(2)}`);
  console.log(` Kalshi simulation balance: $${kalshiBalance.toFixed(2)}`);
  console.log(` Total simulation capital: $${(alpacaCapitalCap + kalshiBalance).toFixed(2)}`);
  console.log(` Bots: ${botStates?.length ?? 0} active`);
  console.log(` Risk params: Kelly 25%, CB 15%, max 5 positions`);
  console.log(` Simulation status: RUNNING`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

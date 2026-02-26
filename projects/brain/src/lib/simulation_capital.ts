import 'dotenv/config';

import { supabaseAdmin } from './supabase';

export async function getSimulationCapitalAlpacaCap(): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('operational_state')
      .select('value,expires_at')
      .eq('domain', 'simulation')
      .eq('key', 'simulation_capital_alpaca')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    const amt = Number((data as any)?.value?.amount);
    return Number.isFinite(amt) ? amt : null;
  } catch {
    return null;
  }
}

export async function capAlpacaDeployableEquity(equity: number): Promise<number> {
  const cap = await getSimulationCapitalAlpacaCap();
  if (!cap) return equity;
  return Math.min(equity, cap);
}

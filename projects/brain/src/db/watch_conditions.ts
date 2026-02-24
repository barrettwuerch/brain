import 'dotenv/config';

import type { WatchCondition } from '../types';

import { supabaseAdmin } from '../lib/supabase';

export async function createWatchCondition(
  wc: Omit<WatchCondition, 'id' | 'created_at' | 'updated_at'>,
): Promise<WatchCondition> {
  const { data, error } = await supabaseAdmin.from('watch_conditions').insert(wc).select('*').single();
  if (error) throw error;
  return data as any;
}

export async function getActiveWatchConditions(marketType?: string): Promise<WatchCondition[]> {
  let q = supabaseAdmin.from('watch_conditions').select('*').eq('status', 'active').order('created_at', { ascending: true });
  if (marketType) q = q.eq('market_type', marketType);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

export async function updateAfterTrigger(id: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('watch_conditions')
    .select('trigger_count,max_triggers_per_day')
    .eq('id', id)
    .single();
  if (error) throw error;

  const trigger_count = Number((data as any).trigger_count ?? 0) + 1;
  const max = Number((data as any).max_triggers_per_day ?? 3);
  const status = trigger_count >= max ? 'max_reached' : 'active';

  const { error: updErr } = await supabaseAdmin
    .from('watch_conditions')
    .update({ trigger_count, status, last_triggered: new Date().toISOString() })
    .eq('id', id);
  if (updErr) throw updErr;
}

export async function pauseWatchCondition(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('watch_conditions').update({ status: 'paused' }).eq('id', id);
  if (error) throw error;
}

export async function resumeWatchCondition(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('watch_conditions').update({ status: 'active' }).eq('id', id);
  if (error) throw error;
}

export async function expireStaleConditions(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('watch_conditions')
    .update({ status: 'expired' })
    .lt('expires_at', new Date().toISOString())
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

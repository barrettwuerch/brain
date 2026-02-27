import 'dotenv/config';

import type { ExitReason, Position } from '../types';

import { supabaseAdmin } from '../lib/supabase';

export async function openPosition(
  p: Omit<Position, 'id' | 'created_at' | 'updated_at'>,
): Promise<Position> {
  const { data, error } = await supabaseAdmin
    .from('positions')
    .insert(p)
    .select('*')
    .single();

  if (error) throw error;
  return data as any;
}

export async function closePosition(
  id: string,
  exitPrice: number,
  exitReason: ExitReason,
  exitEpisodeId?: string,
  actualQty?: number,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('positions')
    .select('entry_price,remaining_size,side')
    .eq('id', id)
    .single();
  if (error) throw error;

  const entry_price = Number((data as any).entry_price);
  const remaining_size = Number((data as any).remaining_size);
  const side = String((data as any).side) as 'yes' | 'no';

  const qty = actualQty ?? remaining_size;
  const pnl = (Number(exitPrice) - entry_price) * qty * (side === 'yes' ? 1 : -1);

  const patch: any = {
    status: 'closed',
    exit_price: Number(exitPrice),
    exit_reason: exitReason,
    closed_at: new Date().toISOString(),
    realized_pnl: pnl,
    remaining_size: 0,
  };
  if (exitEpisodeId) patch.exit_episode_id = exitEpisodeId;

  const { error: updErr } = await supabaseAdmin.from('positions').update(patch).eq('id', id);
  if (updErr) throw updErr;
}

export async function updatePositionPrice(id: string, currentPrice: number): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('positions')
    .select('entry_price,remaining_size,side,peak_price')
    .eq('id', id)
    .single();
  if (error) throw error;

  const entry_price = Number((data as any).entry_price);
  const remaining_size = Number((data as any).remaining_size);
  const side = String((data as any).side) as 'yes' | 'no';
  const peak_price = (data as any).peak_price === null ? null : Number((data as any).peak_price);

  const unrealized_pnl = (Number(currentPrice) - entry_price) * remaining_size * (side === 'yes' ? 1 : -1);
  const newPeak = Math.max(peak_price ?? entry_price, Number(currentPrice));

  const { error: updErr } = await supabaseAdmin
    .from('positions')
    .update({ current_price: Number(currentPrice), unrealized_pnl, peak_price: newPeak })
    .eq('id', id);
  if (updErr) throw updErr;
}

export async function getOpenPositions(desk?: string): Promise<Position[]> {
  let q = supabaseAdmin.from('positions').select('*').eq('status', 'open').order('created_at', { ascending: false });
  if (desk) q = q.eq('desk', desk);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

export async function getPositionsByStrategy(strategyId: string): Promise<Position[]> {
  const { data, error } = await supabaseAdmin
    .from('positions')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as any;
}

export async function findOpenPositionByBotAndTicker(botId: string, ticker: string): Promise<Position | null> {
  const { data, error } = await supabaseAdmin
    .from('positions')
    .select('*')
    .eq('status', 'open')
    .eq('bot_id', botId)
    .eq('market_ticker', ticker)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as any) ?? null;
}

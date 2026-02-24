import 'dotenv/config';

import type { FindingStatus, ResearchFinding } from '../types';

import { supabaseAdmin } from '../lib/supabase';

export async function writeResearchFinding(
  finding: Omit<ResearchFinding, 'id' | 'created_at'>,
): Promise<ResearchFinding> {
  const { data, error } = await supabaseAdmin
    .from('research_findings')
    .insert(finding)
    .select('*')
    .single();

  if (error) throw error;
  return data as any;
}

export async function updateFindingStatus(
  id: string,
  status: FindingStatus,
  extra?: Partial<ResearchFinding>,
): Promise<void> {
  const patch: any = { status, ...(extra ?? {}) };
  delete patch.id;
  delete patch.created_at;

  const { error } = await supabaseAdmin.from('research_findings').update(patch).eq('id', id);
  if (error) throw error;
}

export async function getFindingsByStatus(status: FindingStatus): Promise<ResearchFinding[]> {
  const { data, error } = await supabaseAdmin
    .from('research_findings')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as any;
}

export async function getDeadEndsRegistry(desk: string): Promise<ResearchFinding[]> {
  const { data, error } = await supabaseAdmin
    .from('research_findings')
    .select('*')
    .eq('desk', desk)
    .eq('finding_type', 'dead_end')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as any;
}

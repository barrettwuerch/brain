// Procedural memory layer

import type { Procedure } from '../types';

import { supabaseAdmin, supabase } from '../lib/supabase';

export interface ProcedureWriteInput {
  procedure: Procedure;
}

export interface ProcedureReadInput {
  task_type: string;
}

export async function writeProcedure(input: ProcedureWriteInput): Promise<void> {
  const p = input.procedure as any;
  const task_type = String(p?.task_type ?? '').trim();
  if (!task_type) return;

  // procedures has a unique index on (task_type)
  const payload: any = {
    task_type,
    approach: p?.approach ?? [],
    cautions: p?.cautions ?? [],
    success_pattern: p?.success_pattern ?? null,
    failure_pattern: p?.failure_pattern ?? null,
    avg_success_rate: p?.avg_success_rate ?? null,
    status: p?.status ?? 'active',
    last_updated: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from('procedures').upsert(payload, {
    onConflict: 'task_type',
    ignoreDuplicates: false,
  });
  if (error) throw error;
}

export async function readProcedure(input: ProcedureReadInput): Promise<Procedure | null> {
  const { data, error } = await supabase
    .from('procedures')
    .select('*')
    .eq('task_type', input.task_type)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as any) ?? null;
}

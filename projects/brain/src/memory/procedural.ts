// Procedural memory layer

import type { Procedure } from '../types';

import { supabase } from '../lib/supabase';

export interface ProcedureWriteInput {
  procedure: Procedure;
}

export interface ProcedureReadInput {
  task_type: string;
}

export async function writeProcedure(_input: ProcedureWriteInput): Promise<void> {
  // TODO: upsert procedure for task_type
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

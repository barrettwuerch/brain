// Procedural memory layer — stubs

import type { Procedure } from '../types';

export interface ProcedureWriteInput {
  procedure: Procedure;
}

export interface ProcedureReadInput {
  task_type: string;
}

export async function writeProcedure(_input: ProcedureWriteInput): Promise<void> {
  // TODO: upsert procedure for task_type
}

export async function readProcedure(_input: ProcedureReadInput): Promise<Procedure | null> {
  // TODO: fetch active procedure for task_type
  return null;
}

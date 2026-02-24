// THE BRAIN — Typescript contracts (Phase 1 scaffold)

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type EpisodeOutcome = 'correct' | 'incorrect' | 'partial';
export type MemoryStatus = 'active' | 'flagged' | 'retired';

export interface Task {
  id: string;
  created_at: string;

  task_type: string;
  task_input: Record<string, any>;

  // Trading desk scoping (nullable for generic brain tasks)
  agent_role?: string | null;
  desk?: string | null;
  bot_id?: string | null;

  status: TaskStatus;
  tags: string[];
}

export interface Episode {
  id: string;
  created_at: string;

  task_id?: string | null;
  task_type: string;
  task_input: Record<string, any>;

  // Trading desk scoping (nullable for generic brain episodes)
  agent_role?: string | null;
  desk?: string | null;
  bot_id?: string | null;

  reasoning: string;
  action_taken: Record<string, any>;
  observation: Record<string, any>;
  reflection: string;
  lessons?: string[] | null;

  outcome: EpisodeOutcome;
  outcome_score: number;      // 0..1
  reasoning_score: number;    // 0..1
  error_type?: string | null;

  ttl_days: number;

  // Optional: embeddings stored in DB; represented as number[] in app code
  embedding?: number[] | null;
}

export interface SemanticFact {
  id: string;
  created_at: string;
  last_updated: string;

  domain: string;
  fact: string;

  supporting_episode_ids: string[];

  confidence: number;         // 0..1
  times_confirmed: number;
  times_violated: number;

  status: MemoryStatus;
}

export interface Procedure {
  id: string;
  created_at: string;
  last_updated: string;

  task_type: string;

  // Trading desk scoping (nullable for generic brain procedures)
  agent_role?: string | null;
  desk?: string | null;
  bot_id?: string | null;

  approach: string[];
  cautions: string[];
  success_pattern?: string | null;
  failure_pattern?: string | null;

  avg_success_rate?: number | null;
  status: MemoryStatus;
}

export interface IntelligenceScore {
  id: string;
  created_at: string;

  window_start?: string | null;
  window_end?: string | null;

  metric: string;            // 'accuracy' | 'calibration' | 'transfer_score' | ...
  task_type?: string | null;
  value: number;
  notes?: string | null;

  supporting_episode_ids: string[];
}

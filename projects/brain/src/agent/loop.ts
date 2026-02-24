// THE BRAIN — Core loop skeleton (Phase 1 scaffold)
// REASON → ACT → OBSERVE → REFLECT → STORE

import type { Episode, EpisodeOutcome, Task } from '../types';

export interface ReasonInput {
  task: Task;
  memory: {
    episodic: Episode[];
    semantic: { fact: string; confidence: number }[];
    procedure?: { approach: string[]; cautions: string[] } | null;
  };
}

export interface ReasonOutput {
  reasoning_text: string;
  planned_action: Record<string, any>; // Task-specific action payload
}

export interface ActOutput {
  action_taken: Record<string, any>;   // Exact action executed
}

export interface ObserveOutput {
  observation: Record<string, any>;    // Exact outcome from tools/world
}

export interface ReflectOutput {
  reflection_text: string;
  outcome: EpisodeOutcome;
  outcome_score: number;               // 0..1
  reasoning_score: number;             // 0..1 (self-evaluated calibration target)
  error_type?: string;
}

export interface StoreOutput {
  episode_written: boolean;
  semantic_updates: number;
  procedure_updates: number;
}

export class BrainLoop {
  /**
   * Run the full loop once for a single task.
   * This should:
   *  - retrieve relevant memory
   *  - reason about what to do (externalized text)
   *  - take an action
   *  - capture the observation
   *  - reflect and score reasoning/outcome
   *  - store episode + (optionally) semantic/procedural updates
   */
  async run(task: Task): Promise<{ episode: Episode; store: StoreOutput }> {
    // 1) REASON
    const reasonOut = await this.reason({
      task,
      memory: { episodic: [], semantic: [], procedure: null },
    });

    // 2) ACT
    const actOut = await this.act(reasonOut);

    // 3) OBSERVE
    const obsOut = await this.observe(actOut);

    // 4) REFLECT
    const refOut = await this.reflect({ task, reasonOut, actOut, obsOut });

    // 5) STORE
    const episode: Episode = {
      id: 'stub',
      created_at: new Date().toISOString(),
      task_id: task.id,
      task_type: task.task_type,
      task_input: task.task_input,
      reasoning: reasonOut.reasoning_text,
      action_taken: actOut.action_taken,
      observation: obsOut.observation,
      reflection: refOut.reflection_text,
      outcome: refOut.outcome,
      outcome_score: refOut.outcome_score,
      reasoning_score: refOut.reasoning_score,
      error_type: refOut.error_type ?? null,
      ttl_days: 30,
      embedding: null,
    };

    const storeOut = await this.store({ task, episode, refOut });

    return { episode, store: storeOut };
  }

  /** REASON: decide what to do given task + retrieved memory. */
  async reason(input: ReasonInput): Promise<ReasonOutput> {
    // TODO: implement ReAct-style reasoning prompt injection.
    // Must externalize reasoning as text, plus a single next action.
    return {
      reasoning_text: 'TODO(reason): externalized reasoning',
      planned_action: { type: 'noop' },
    };
  }

  /** ACT: execute the planned action (single step). */
  async act(reason: ReasonOutput): Promise<ActOutput> {
    // TODO: route to task-specific executor / tool calls.
    return { action_taken: reason.planned_action };
  }

  /** OBSERVE: capture the full-fidelity outcome from the world/tools. */
  async observe(act: ActOutput): Promise<ObserveOutput> {
    // TODO: gather tool outputs, errors, timing, context.
    return { observation: { ok: true, action: act.action_taken } };
  }

  /** REFLECT: evaluate performance and score reasoning quality vs outcome. */
  async reflect(args: {
    task: Task;
    reasonOut: ReasonOutput;
    actOut: ActOutput;
    obsOut: ObserveOutput;
  }): Promise<ReflectOutput> {
    // TODO: Reflexion-style prompt:
    // - was the reasoning correct?
    // - did it predict the outcome?
    // - what went wrong/right?
    // - rate reasoning quality 1-5 → map to 0..1
    return {
      reflection_text: 'TODO(reflect): reflection + guidance',
      outcome: 'partial',
      outcome_score: 0.5,
      reasoning_score: 0.5,
    };
  }

  /** STORE: write episode; optionally consolidate semantic/procedural memory. */
  async store(args: {
    task: Task;
    episode: Episode;
    refOut: ReflectOutput;
  }): Promise<StoreOutput> {
    // TODO:
    // - persist episode immediately
    // - decide whether to update semantic facts / procedures
    // - enforce pruning / TTL policies in background
    return { episode_written: false, semantic_updates: 0, procedure_updates: 0 };
  }
}

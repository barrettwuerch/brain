// THE BRAIN — Core loop skeleton (Phase 1 scaffold)
// REASON → ACT → OBSERVE → REFLECT → STORE

import type { Episode, EpisodeOutcome, Task } from '../types';
import { grade, maxMoM, maxRow, parseCpi, trendLastN } from './level1_compute';
import { embed } from '../lib/embeddings';
import { supabaseAdmin } from '../lib/supabase';

export interface ReasonInput {
  task: Task;
  memory: {
    episodic: Episode[];
    semantic: { fact: string; confidence: number }[];
    procedure?: { approach: string[]; cautions: string[] } | null;
  };
}

export interface ReasonOutput {
  chain_of_thought: string;
  proposed_action: Record<string, any>; // Task-specific action payload
  confidence: number;                  // 0..1
  uncertainty_flags: string[];
}

export interface ActOutput {
  action_taken: Record<string, any>;   // Exact action executed
  result: Record<string, any>;         // Raw result (before grading)
  outcome_score?: number;              // 0..1 when ground truth available
}

export interface ObserveOutput {
  actual: Record<string, any>;
  expected: Record<string, any> | null;
  outcome_score: number;               // 0..1
  outcome: EpisodeOutcome;
  error_type?: string;
}

export interface ReflectOutput {
  reflection_text: string;
  reasoning_score: number;             // 0..1
  lessons: string[];
}

export interface StoreOutput {
  episode_id?: string;
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
    // Phase 3: full loop with observe/reflect/store.
    let reasonOut: ReasonOutput;
    let actOut: ActOutput;
    let obsOut: ObserveOutput;
    let refOut: ReflectOutput;

    try {
      reasonOut = await this.reason({ task, memory: { episodic: [], semantic: [], procedure: null } });
    } catch (e) {
      // Mark task failed and bail.
      await supabaseAdmin.from('tasks').update({ status: 'failed' }).eq('id', task.id);
      throw e;
    }

    try {
      actOut = await this.act({ task, reasonOut });
    } catch (e) {
      await supabaseAdmin.from('tasks').update({ status: 'failed' }).eq('id', task.id);
      throw e;
    }

    obsOut = await this.observe({ task, reasonOut, actOut });

    try {
      refOut = await this.reflect({ task, reasonOut, obsOut });
    } catch (e) {
      // Reflection failure should not lose the episode; we can store a minimal reflection.
      refOut = { reflection_text: 'Reflection failed to run.', reasoning_score: 0.3, lessons: ['Fix reflection pipeline / prompt.'] };
    }

    const ttl_days = obsOut.outcome === 'incorrect' ? 60 : 30;

    const episode: Episode = {
      id: 'stub',
      created_at: new Date().toISOString(),
      task_id: task.id,
      task_type: task.task_type,
      task_input: task.task_input,
      reasoning: reasonOut.chain_of_thought,
      action_taken: actOut.action_taken,
      observation: { actual: obsOut.actual, expected: obsOut.expected },
      reflection: refOut.reflection_text,
      outcome: obsOut.outcome,
      outcome_score: obsOut.outcome_score,
      reasoning_score: refOut.reasoning_score,
      error_type: obsOut.error_type ?? null,
      ttl_days,
      embedding: null,
    };

    const storeOut = await this.store({ task, episode, reasonOut, refOut });
    // On success, mark task completed.
    await supabaseAdmin.from('tasks').update({ status: 'completed' }).eq('id', task.id);

    return { episode: { ...episode, id: storeOut.episode_id ?? episode.id }, store: storeOut };
  }

  /** REASON: decide what to do given task + retrieved memory. */
  async reason(input: ReasonInput): Promise<ReasonOutput> {
    // Phase 2: ReAct-style reasoner.
    // - MEMORY CONTEXT slot exists (empty for now)
    // - TASK injected
    // - INSTRUCTIONS enforce JSON-only output

    const memoryContext = [
      `EPISODIC:\n${input.memory.episodic.map(e => `- ${e.task_type}: ${e.outcome} (${e.outcome_score})`).join('\n') || '(none)'}`,
      `SEMANTIC:\n${input.memory.semantic.map(f => `- (${f.confidence}) ${f.fact}`).join('\n') || '(none)'}`,
      `PROCEDURE:\n${input.memory.procedure ? input.memory.procedure.approach.join('\n') : '(none)'}`,
    ].join('\n\n');

    const system = `You are THE BRAIN's REASON step. You must think before acting.\n\nReturn ONLY valid JSON with keys: chain_of_thought, proposed_action, confidence, uncertainty_flags.\n\nAllowed proposed_action shapes:\n- { \'type\': 'compute_max', dataset_url: string }\n- { \'type\': 'compute_max_mom_delta', dataset_url: string }\n- { \'type\': 'compute_trend_last_n', dataset_url: string, n: number }\n\nDo not include Observation; Observation is produced by ACT.`;

    const user = `MEMORY CONTEXT\n${memoryContext}\n\nTASK\nTask type: ${input.task.task_type}\nTask input (JSON): ${JSON.stringify(input.task.task_input)}\n\nINSTRUCTIONS\nUse a ReAct-like structure internally: Thought -> Action (choose one).\nOutput must be JSON only.`;

    const testMode = String(process.env.BRAIN_TEST_MODE || '').toLowerCase() === 'true';

    if (testMode) {
      // Hardcoded but realistic decision-making for Level 1.
      const url = (input.task.task_input as any)?.dataset?.url;
      const q = String((input.task.task_input as any)?.question ?? '').toLowerCase();
      let proposed_action: Record<string, any> = { type: 'compute_max', dataset_url: url };
      if (q.includes('month-over-month') || q.includes('month over month') || q.includes('delta')) {
        proposed_action = { type: 'compute_max_mom_delta', dataset_url: url };
      } else if (q.includes('trending') || q.includes('trend') || q.includes('last 6')) {
        proposed_action = { type: 'compute_trend_last_n', dataset_url: url, n: 6 };
      }

      return {
        chain_of_thought:
          `MEMORY: (empty in Phase 3 test mode)\n` +
          `TASK: ${input.task.task_type}\n` +
          `PLAN: Choose the simplest computation matching the question.\n` +
          `ACTION: ${JSON.stringify(proposed_action)}\n` +
          `UNCERTAINTY: Dataset format or missing values could affect parsing.`,
        proposed_action,
        confidence: 0.78,
        uncertainty_flags: ['csv_format_mismatch', 'missing_values_possible'],
      };
    }

    const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic.js');
    const raw = await claudeText({ system, user, maxTokens: 700, temperature: 0.2 });
    const parsed = extractFirstJsonObject(raw);

    return {
      chain_of_thought: String(parsed.chain_of_thought ?? ''),
      proposed_action: (parsed.proposed_action ?? { type: 'noop' }) as Record<string, any>,
      confidence: Number(parsed.confidence ?? 0.5),
      uncertainty_flags: Array.isArray(parsed.uncertainty_flags) ? parsed.uncertainty_flags.map(String) : [],
    };
  }

  /** ACT: execute the planned action (single step). */
  async act(args: { task: Task; reasonOut: ReasonOutput }): Promise<ActOutput> {
    const a = args.reasonOut.proposed_action || { type: 'noop' };

    // Level-1 computation executors.
    const tInput: any = args.task.task_input || {};
    const url: string | undefined = a.dataset_url || tInput?.dataset?.url;

    const action_taken = a;

    if (!url || typeof url !== 'string') {
      return { action_taken, result: { ok: false, error: 'missing_dataset_url' }, outcome_score: 0 };
    }

    const csv = await (await fetch(url)).text();
    const rows = parseCpi(csv);

    let result: Record<string, any> = { ok: true };

    if (a.type === 'compute_max') {
      const m = maxRow(rows);
      result = { date: m.date, value: m.value };
    } else if (a.type === 'compute_max_mom_delta') {
      const m = maxMoM(rows);
      result = { date: m.date, delta: m.delta };
    } else if (a.type === 'compute_trend_last_n') {
      const n = Number(a.n ?? 6);
      result = { trend: trendLastN(rows, n) };
    } else {
      result = { ok: false, error: `unknown_action_type:${String(a.type)}` };
    }

    const expected = tInput.expected_answer;
    const outcome_score = expected ? grade(expected, result) : undefined;

    return { action_taken, result, outcome_score };
  }

  /** OBSERVE: capture the full-fidelity outcome from the world/tools. */
  async observe(args: { task: Task; reasonOut: ReasonOutput; actOut: ActOutput }): Promise<ObserveOutput> {
    const expected = (args.task.task_input as any)?.expected_answer ?? null;
    const actual = args.actOut.result;

    // Binary grading for Level 1.
    const outcome_score = expected ? grade(expected, actual) : 0;
    const outcome: EpisodeOutcome = outcome_score === 1 ? 'correct' : 'incorrect';

    // Lightweight error typing.
    let error_type: string | undefined;
    if (outcome === 'incorrect') {
      const actionType = String(args.reasonOut.proposed_action?.type ?? 'unknown');
      if (actionType === 'unknown' || actionType === 'noop') error_type = 'reasoning_error';
      else if (String(actual?.error || '').includes('dataset')) error_type = 'data_error';
      else error_type = 'computation_error';
    }

    return { actual, expected, outcome_score, outcome, error_type };
  }

  /** REFLECT: evaluate performance and score reasoning quality vs outcome. */
  async reflect(args: {
    task: Task;
    reasonOut: ReasonOutput;
    obsOut: ObserveOutput;
  }): Promise<ReflectOutput> {
    const system = `You are THE BRAIN's REFLECT step. Be brutally honest.
Return ONLY valid JSON with keys: reflection_text, reasoning_score, lessons.
- reasoning_score is 0..1.
- lessons is an array of concrete, actionable adjustments.
Scoring rubric:
- Correct but shallow/fragile reasoning => <=0.6
- Incorrect but flagged uncertainty appropriately => 0.4-0.6
- Incorrect and overconfident / missed obvious uncertainty => <=0.3
`;

    const user = `TASK\n${JSON.stringify(args.task.task_input)}\n\nCHAIN_OF_THOUGHT\n${args.reasonOut.chain_of_thought}\n\nPROPOSED_ACTION\n${JSON.stringify(args.reasonOut.proposed_action)}\n\nUNCERTAINTY_FLAGS\n${JSON.stringify(args.reasonOut.uncertainty_flags)}\n\nEXPECTED\n${JSON.stringify(args.obsOut.expected)}\n\nACTUAL\n${JSON.stringify(args.obsOut.actual)}\n\nOUTCOME\n${args.obsOut.outcome} score=${args.obsOut.outcome_score}`;

    const testMode = String(process.env.BRAIN_TEST_MODE || '').toLowerCase() === 'true';

    if (testMode) {
      const correct = args.obsOut.outcome === 'correct';
      return {
        reflection_text: correct
          ? 'Reasoning matched the question type and produced the expected result. Uncertainty flags were appropriate but non-blocking.'
          : 'I selected an action that did not yield the expected answer. I should have verified the dataset parsing assumptions and cross-checked the computed result against the expected structure before committing.',
        reasoning_score: correct ? 0.82 : 0.42,
        lessons: correct
          ? ['Keep matching question wording to computation type; keep uncertainty flags explicit.']
          : [
              'Before acting, restate the expected answer shape (keys/types) and ensure the proposed action will produce it.',
              'If CSV schema is unknown, inspect header row and handle missing/blank values explicitly.',
            ],
      };
    }

    const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic.js');
    const raw = await claudeText({ system, user, maxTokens: 600, temperature: 0.2 });
    const parsed = extractFirstJsonObject(raw);

    return {
      reflection_text: String(parsed.reflection_text ?? ''),
      reasoning_score: Number(parsed.reasoning_score ?? 0.5),
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.map(String) : [],
    };
  }

  /** STORE: write complete episode with embedding to Supabase. */
  async store(args: {
    task: Task;
    episode: Episode;
    reasonOut: ReasonOutput;
    refOut: ReflectOutput;
  }): Promise<StoreOutput> {
    const textToEmbed = `${args.reasonOut.chain_of_thought}\n\nREFLECTION:\n${args.refOut.reflection_text}`;
    const vec = await embed(textToEmbed);

    // PostgREST + pgvector: represent vector as string like '[1,2,3]'
    const embedding = `[${vec.join(',')}]`;

    const row: any = {
      task_id: args.task.id,
      task_type: args.task.task_type,
      task_input: args.task.task_input,
      reasoning: args.episode.reasoning,
      action_taken: args.episode.action_taken,
      observation: args.episode.observation,
      reflection: args.episode.reflection,
      outcome: args.episode.outcome,
      outcome_score: args.episode.outcome_score,
      reasoning_score: args.episode.reasoning_score,
      error_type: args.episode.error_type,
      ttl_days: args.episode.ttl_days,
      embedding,
    };

    const { data, error } = await supabaseAdmin
      .from('episodes')
      .insert(row)
      .select('id')
      .single();

    if (error) throw error;

    return {
      episode_id: (data as any)?.id,
      episode_written: true,
      semantic_updates: 0,
      procedure_updates: 0,
    };
  }
}

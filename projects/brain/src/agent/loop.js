// THE BRAIN — Core loop skeleton (Phase 1 scaffold)
// REASON → ACT → OBSERVE → REFLECT → STORE
import { grade, maxMoM, maxRow, parseCpi, trendLastN } from './level1_compute';
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
    async run(task) {
        // 1) REASON
        const reasonOut = await this.reason({
            task,
            memory: { episodic: [], semantic: [], procedure: null },
        });
        // 2) ACT
        const actOut = await this.act({ task, reasonOut });
        // 3) OBSERVE
        const obsOut = await this.observe(actOut);
        // 4) REFLECT
        const refOut = await this.reflect({ task, reasonOut, actOut, obsOut });
        // 5) STORE
        const episode = {
            id: 'stub',
            created_at: new Date().toISOString(),
            task_id: task.id,
            task_type: task.task_type,
            task_input: task.task_input,
            reasoning: reasonOut.chain_of_thought,
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
    async reason(input) {
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
        const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic.js');
        const raw = await claudeText({ system, user, maxTokens: 700, temperature: 0.2 });
        const parsed = extractFirstJsonObject(raw);
        return {
            chain_of_thought: String(parsed.chain_of_thought ?? ''),
            proposed_action: (parsed.proposed_action ?? { type: 'noop' }),
            confidence: Number(parsed.confidence ?? 0.5),
            uncertainty_flags: Array.isArray(parsed.uncertainty_flags) ? parsed.uncertainty_flags.map(String) : [],
        };
    }
    /** ACT: execute the planned action (single step). */
    async act(args) {
        const a = args.reasonOut.proposed_action || { type: 'noop' };
        // Level-1 computation executors.
        const tInput = args.task.task_input || {};
        const url = a.dataset_url || tInput?.dataset?.url;
        const action_taken = a;
        if (!url || typeof url !== 'string') {
            return { action_taken, result: { ok: false, error: 'missing_dataset_url' }, outcome_score: 0 };
        }
        const csv = await (await fetch(url)).text();
        const rows = parseCpi(csv);
        let result = { ok: true };
        if (a.type === 'compute_max') {
            const m = maxRow(rows);
            result = { date: m.date, value: m.value };
        }
        else if (a.type === 'compute_max_mom_delta') {
            const m = maxMoM(rows);
            result = { date: m.date, delta: m.delta };
        }
        else if (a.type === 'compute_trend_last_n') {
            const n = Number(a.n ?? 6);
            result = { trend: trendLastN(rows, n) };
        }
        else {
            result = { ok: false, error: `unknown_action_type:${String(a.type)}` };
        }
        const expected = tInput.expected_answer;
        const outcome_score = expected ? grade(expected, result) : undefined;
        return { action_taken, result, outcome_score };
    }
    /** OBSERVE: capture the full-fidelity outcome from the world/tools. */
    async observe(act) {
        // TODO: gather tool outputs, errors, timing, context.
        return { observation: { ok: true, action: act.action_taken } };
    }
    /** REFLECT: evaluate performance and score reasoning quality vs outcome. */
    async reflect(args) {
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
    async store(args) {
        // TODO:
        // - persist episode immediately
        // - decide whether to update semantic facts / procedures
        // - enforce pruning / TTL policies in background
        return { episode_written: false, semantic_updates: 0, procedure_updates: 0 };
    }
}

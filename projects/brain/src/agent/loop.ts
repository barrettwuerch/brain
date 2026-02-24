// THE BRAIN — Core loop skeleton (Phase 1 scaffold)
// STATE_CHECK → REASON → ACT → OBSERVE → REFLECT → STORE

import type { Episode, EpisodeOutcome, Task } from '../types';
import { grade, maxMoM, maxRow, parseCpi, trendLastN } from './level1_compute';
import { classifyMomentum, trendFromYesPrices, volumeAnomaly } from './trading_compute';
import { embed } from '../lib/embeddings';
import { supabaseAdmin } from '../lib/supabase';
import { readSimilarEpisodes } from '../memory/episodic';
import { readSemanticFacts } from '../memory/semantic';
import { readProcedure } from '../memory/procedural';
import { writeEpisode } from '../memory/episodic';
import { checkStateBeforeRun } from '../behavioral/state_manager';
import { formatAndStoreFinding } from '../bots/research/research_output';
import { classifyMomentum as researchClassifyMomentum, detectVolumeAnomaly as researchDetectVolumeAnomaly, scanMarketTrend as researchScanMarketTrend, scoreRQS as researchScoreRQS } from '../bots/research/research_compute';
import { formalizeStrategy, detectOverfitting, computeWalkForwardWindows } from '../bots/strategy/strategy_compute';
import { runBacktest } from '../bots/strategy/backtest_engine';
import { updateFindingStatus } from '../db/research_findings';
import { checkAndFireBreakers, DEFAULT_THRESHOLDS } from '../bots/risk/circuit_breakers';
import {
  computeDrawdownVelocity,
  computeENP,
  drawdownToRecoveryRequired,
  evaluateCircuitBreakers,
  getKellyMultiplier,
} from '../bots/risk/risk_compute';
import {
  computePositionSize as execComputePositionSize,
  estimateSlippage as execEstimateSlippage,
  isTradeableMarket as execIsTradeableMarket,
} from '../bots/execution/execution_compute';
import { evaluateExit, handlePartialFill, placeOrder } from '../bots/execution/order_manager';

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
  async run(task: Task): Promise<{ episode: Episode; store: StoreOutput } | { aborted: true; reason: string }> {
    // STATE_CHECK: behavioral state gate before anything else.
    const stateCheck = await checkStateBeforeRun(task);
    if (stateCheck.shouldAbort) {
      // Requeue task and abort without writing an episode.
      await supabaseAdmin.from('tasks').update({ status: 'queued' }).eq('id', task.id);
      return { aborted: true, reason: stateCheck.reason };
    }

    // Phase 3: full loop with observe/reflect/store.
    let reasonOut: ReasonOutput;
    let actOut: ActOutput;
    let obsOut: ObserveOutput;
    let refOut: ReflectOutput;

    // Phase 4: retrieve memory context before reasoning.
    const episodic = await readSimilarEpisodes({ task_type: task.task_type, task_input: task.task_input, limit: 5 });
    const semanticFacts = await readSemanticFacts({ domain: task.task_type, limit: 8 });
    const procedure = await readProcedure({ task_type: task.task_type });

    try {
      reasonOut = await this.reason({
        task,
        memory: {
          episodic,
          semantic: semanticFacts.map((f) => ({ fact: f.fact, confidence: f.confidence })),
          procedure: procedure ? { approach: procedure.approach, cautions: procedure.cautions } : null,
        },
      });
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

      agent_role: task.agent_role ?? null,
      desk: task.desk ?? null,
      bot_id: task.bot_id ?? null,

      reasoning: reasonOut.chain_of_thought,
      action_taken: actOut.action_taken,
      observation: { actual: obsOut.actual, expected: obsOut.expected },
      reflection: refOut.reflection_text,
      lessons: refOut.lessons,
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

    const storedEpisode = { ...episode, id: storeOut.episode_id ?? episode.id };

    // Strategy Bot: after run_backtest, update the linked research_finding status.
    if (task.agent_role === 'strategy' && task.task_type === 'run_backtest') {
      try {
        const rep: any = actOut.result;
        const findingId = String(rep?.finding_id ?? '');
        const rec = String(rep?.recommendation ?? '');
        if (findingId) {
          if (rec === 'approved_for_forward_test') {
            await updateFindingStatus(findingId, 'in_backtest');
          } else if (rec === 'archived') {
            await updateFindingStatus(findingId, 'archived');
          } else if (rec === 'return_to_research') {
            await updateFindingStatus(findingId, 'under_investigation');
          }
        }
      } catch (e: any) {
        console.error('[strategy] failed to update finding status:', e?.message ?? e);
      }
    }

    // Risk Bot: after evaluating circuit breakers, pause affected bots if any breach fired.
    if (task.agent_role === 'risk' && task.task_type === 'evaluate_circuit_breakers') {
      try {
        const snapshot = (task.task_input as any)?.snapshot;
        if (snapshot) {
          const { data, error } = await supabaseAdmin
            .from('bot_states')
            .select('bot_id')
            .neq('bot_id', 'risk-bot-1');
          if (error) throw error;
          const botIds = (data ?? []).map((r: any) => String(r.bot_id));

          await checkAndFireBreakers(snapshot, botIds);
        }
      } catch (e: any) {
        console.error('[risk] checkAndFireBreakers failed:', e?.message ?? e);
      }
    }

    // Research Bot: format + store finding (needs stored episode UUID for supporting_episode_ids).
    if (task.agent_role === 'research' && storeOut.episode_id) {
      try {
        const finding = await formatAndStoreFinding(storedEpisode, actOut.result);
        if (finding) {
          // Attach finding_id to lessons on the episode row.
          const lessons = Array.isArray(storedEpisode.lessons) ? [...storedEpisode.lessons] : [];
          lessons.push(`finding_id:${finding.id}`);

          await supabaseAdmin
            .from('episodes')
            .update({ lessons })
            .eq('id', storeOut.episode_id);

          storedEpisode.lessons = lessons;
        }
      } catch (e: any) {
        console.error('[research_output] failed to store finding:', e?.message ?? e);
      }
    }

    return { episode: storedEpisode, store: storeOut };
  }

  /** REASON: decide what to do given task + retrieved memory. */
  async reason(input: ReasonInput): Promise<ReasonOutput> {
    // Phase 2: ReAct-style reasoner.
    // - MEMORY CONTEXT slot exists (empty for now)
    // - TASK injected
    // - INSTRUCTIONS enforce JSON-only output

    // Assemble memory context with a token budget.
    // Budgeting heuristic: words × 1.3 ≈ tokens.
    const estimateTokens = (s: string) => Math.ceil((s.trim().split(/\s+/).filter(Boolean).length || 0) * 1.3);
    const MAX_TOKENS = 3000;

    const parts: { label: string; text: string; tokens: number }[] = [];

    // Priority 1: similar episodes (up to 5)
    const epLines = (input.memory.episodic ?? []).slice(0, 5).map((e) => {
      const refl = String(e.reflection ?? '').slice(0, 400);
      const reasoning = String(e.reasoning ?? '').slice(0, 400);
      return [
        `- id=${e.id} type=${e.task_type} outcome=${e.outcome} os=${e.outcome_score} rs=${e.reasoning_score}`,
        `  reasoning: ${reasoning || '(empty)'}`,
        `  reflection: ${refl || '(empty)'}`,
      ].join('\n');
    });
    const episodicText = `EPISODIC:\n${epLines.length ? epLines.join('\n') : '(none)'}`;
    parts.push({ label: 'episodic', text: episodicText, tokens: estimateTokens(episodicText) });

    // Priority 2: semantic facts (confidence > 0.65)
    const semLines = (input.memory.semantic ?? [])
      .filter((f) => Number(f.confidence ?? 0) > 0.65)
      .map((f) => `- (${Number(f.confidence).toFixed(2)}) ${String(f.fact)}`);
    const semanticText = `SEMANTIC:\n${semLines.length ? semLines.join('\n') : '(none)'}`;
    parts.push({ label: 'semantic', text: semanticText, tokens: estimateTokens(semanticText) });

    // Priority 3: procedure
    const procLines = input.memory.procedure
      ? [
          'APPROACH:',
          ...(input.memory.procedure.approach ?? []).map((s) => `- ${s}`),
          'CAUTIONS:',
          ...(input.memory.procedure.cautions ?? []).map((s) => `- ${s}`),
        ]
      : ['(none)'];
    const procedureText = `PROCEDURE:\n${procLines.join('\n')}`;
    parts.push({ label: 'procedure', text: procedureText, tokens: estimateTokens(procedureText) });

    // Enforce budget by dropping/truncating lowest priority content.
    const total = () => parts.reduce((sum, p) => sum + p.tokens, 0);

    // If over budget, first drop procedure.
    if (total() > MAX_TOKENS) {
      const i = parts.findIndex((p) => p.label === 'procedure');
      if (i >= 0) parts.splice(i, 1);
    }

    // If still over budget, trim semantic facts.
    while (total() > MAX_TOKENS) {
      const semIdx = parts.findIndex((p) => p.label === 'semantic');
      if (semIdx < 0) break;
      const lines = parts[semIdx].text.split('\n');
      // Remove one fact line at a time (keep header).
      if (lines.length <= 2) {
        parts.splice(semIdx, 1);
        break;
      }
      lines.pop();
      const newText = lines.join('\n');
      parts[semIdx] = { ...parts[semIdx], text: newText, tokens: estimateTokens(newText) };
    }

    // If still over budget, trim episodic reflections/reasoning.
    while (total() > MAX_TOKENS) {
      const epIdx = parts.findIndex((p) => p.label === 'episodic');
      if (epIdx < 0) break;
      // Hard truncate the episodic block as last resort.
      const newText = parts[epIdx].text.slice(0, Math.max(0, parts[epIdx].text.length - 500));
      parts[epIdx] = { ...parts[epIdx], text: newText, tokens: estimateTokens(newText) };
      if (parts[epIdx].text.length < 200) break;
    }

    const memoryContext = parts.map((p) => p.text).join('\n\n');

    const system = `You are THE BRAIN's REASON step. You must think before acting.\n\nReturn ONLY valid JSON with keys: chain_of_thought, proposed_action, confidence, uncertainty_flags.\n\nAllowed proposed_action shapes:\n- { \'type\': 'compute_max', dataset_url: string }\n- { \'type\': 'compute_max_mom_delta', dataset_url: string }\n- { \'type\': 'compute_trend_last_n', dataset_url: string, n: number }\n- { \'type\': 'scan_market_trend' }\n- { \'type\': 'detect_volume_anomaly' }\n- { \'type\': 'classify_price_momentum' }\n- { \'type\': 'score_rqs' }\n- { \'type\': 'monitor_positions' }\n- { \'type\': 'check_drawdown_limit' }\n- { \'type\': 'detect_concentration' }\n- { \'type\': 'evaluate_circuit_breakers' }\n- { \'type\': 'size_position' }\n- { \'type\': 'place_limit_order' }\n- { \'type\': 'manage_open_position' }\n- { \'type\': 'compute_position_size' }\n- { \'type\': 'handle_partial_fill' }\n- { \'type\': 'evaluate_market_conditions' }\n\nDo not include Observation; Observation is produced by ACT.`;

    const user = `MEMORY CONTEXT\n${memoryContext}\n\nTASK\nTask type: ${input.task.task_type}\nTask input (JSON): ${JSON.stringify(input.task.task_input)}\n\nINSTRUCTIONS\nUse a ReAct-like structure internally: Thought -> Action (choose one).\nOutput must be JSON only.`;

    const testMode = String(process.env.BRAIN_TEST_MODE || '').toLowerCase() === 'true';

    if (testMode) {
      // Hardcoded but realistic decision-making for Phase 3/6 test mode.
      const url = (input.task.task_input as any)?.dataset?.url;
      const q = String((input.task.task_input as any)?.question ?? '').toLowerCase();

      // CPI actions default
      let proposed_action: Record<string, any> = { type: 'compute_max', dataset_url: url };
      if (q.includes('month-over-month') || q.includes('month over month') || q.includes('delta')) {
        proposed_action = { type: 'compute_max_mom_delta', dataset_url: url };
      } else if (q.includes('trending') || q.includes('trend') || q.includes('last 6')) {
        proposed_action = { type: 'compute_trend_last_n', dataset_url: url, n: 6 };
      }

      // Trading actions (based on task_type)
      if (input.task.task_type === 'market_trend_scan') proposed_action = { type: 'scan_market_trend' };
      if (input.task.task_type === 'volume_anomaly_detect') proposed_action = { type: 'detect_volume_anomaly' };
      if (input.task.task_type === 'price_momentum_classify') proposed_action = { type: 'classify_price_momentum' };
      if (input.task.task_type === 'formalize_strategy') proposed_action = { type: 'formalize_strategy' };
      if (input.task.task_type === 'run_backtest') proposed_action = { type: 'run_backtest' };
      if (input.task.task_type === 'detect_overfitting') proposed_action = { type: 'detect_overfitting' };
      if (input.task.task_type === 'walk_forward_analysis') proposed_action = { type: 'walk_forward_analysis' };
      if (input.task.task_type === 'monitor_positions') proposed_action = { type: 'monitor_positions' };
      if (input.task.task_type === 'check_drawdown_limit') proposed_action = { type: 'check_drawdown_limit' };
      if (input.task.task_type === 'detect_concentration') proposed_action = { type: 'detect_concentration' };
      if (input.task.task_type === 'evaluate_circuit_breakers') proposed_action = { type: 'evaluate_circuit_breakers' };
      if (input.task.task_type === 'size_position') proposed_action = { type: 'size_position' };
      if (input.task.task_type === 'place_limit_order') proposed_action = { type: 'place_limit_order' };
      if (input.task.task_type === 'manage_open_position') proposed_action = { type: 'manage_open_position' };
      if (input.task.task_type === 'compute_position_size') proposed_action = { type: 'compute_position_size' };
      if (input.task.task_type === 'handle_partial_fill') proposed_action = { type: 'handle_partial_fill' };
      if (input.task.task_type === 'evaluate_market_conditions') proposed_action = { type: 'evaluate_market_conditions' };

      return {
        chain_of_thought:
          `MEMORY CONTEXT\n${memoryContext}\n` +
          `\nTASK: ${input.task.task_type}\n` +
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

    const tInput: any = args.task.task_input || {};
    const action_taken = a;

    // Research computations (use frozen snapshot in task_input; no API calls here).
    // Note: Research task snapshots use `prices`, `currentVol`, `avgVol`.
    if (a.type === 'scan_market_trend') {
      const isResearch = args.task.agent_role === 'research' || ['market_trend_scan'].includes(args.task.task_type);
      if (isResearch) {
        const prices: number[] = Array.isArray(tInput.prices) ? tInput.prices.map(Number) : [];
        const res = researchScanMarketTrend(prices);
        const expected = tInput.expected_answer;
        const outcome_score = expected ? grade(expected, res) : undefined;
        return { action_taken, result: res, outcome_score };
      }

      // Trading curriculum tasks snapshot uses `price_points_yes`.
      const prices: number[] = Array.isArray(tInput.price_points_yes) ? tInput.price_points_yes.map(Number) : [];
      const trend = trendFromYesPrices(prices);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, { trend }) : undefined;
      return { action_taken, result: { trend }, outcome_score };
    }

    if (a.type === 'detect_volume_anomaly') {
      const isResearch = args.task.agent_role === 'research' || ['volume_anomaly_detect'].includes(args.task.task_type);
      if (isResearch) {
        const currentVol = Number(tInput.currentVol ?? 0);
        const avgVol = Number(tInput.avgVol ?? 0);
        const res = researchDetectVolumeAnomaly(currentVol, avgVol);
        const expected = tInput.expected_answer;
        const outcome_score = expected ? grade(expected, res) : undefined;
        return { action_taken, result: res, outcome_score };
      }

      const current_volume = Number(tInput.current_volume ?? 0);
      const avg_volume = Number(tInput.avg_volume ?? 0);
      const res = volumeAnomaly(current_volume, avg_volume);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, res) : undefined;
      return { action_taken, result: res, outcome_score };
    }

    if (a.type === 'classify_price_momentum') {
      const isResearch = args.task.agent_role === 'research' || ['price_momentum_classify'].includes(args.task.task_type);
      if (isResearch) {
        const prices: number[] = Array.isArray(tInput.prices) ? tInput.prices.map(Number) : [];
        const res = researchClassifyMomentum(prices);
        const expected = tInput.expected_answer;
        const outcome_score = expected ? grade(expected, res) : undefined;
        return { action_taken, result: res, outcome_score };
      }

      const prices: number[] = Array.isArray(tInput.price_points_yes) ? tInput.price_points_yes.map(Number) : [];
      const momentum = classifyMomentum(prices);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, { momentum }) : undefined;
      return { action_taken, result: { momentum }, outcome_score };
    }

    if (a.type === 'score_rqs') {
      const components = tInput.components ?? tInput.rqs_components;
      const rqs_score = components ? researchScoreRQS(components) : 0;
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, { rqs_score }) : undefined;
      return { action_taken, result: { rqs_score }, outcome_score };
    }

    // Risk computations
    if (args.task.agent_role === 'risk' && args.task.task_type === 'monitor_positions') {
      const dd = Number(tInput.drawdownPct ?? 0);
      const tradesSincePeak = Number(tInput.tradesSincePeak ?? 1);
      const correlationMatrix = (tInput.correlationMatrix ?? []) as number[][];
      const enp = computeENP(correlationMatrix);
      const drawdown_velocity = computeDrawdownVelocity(dd, tradesSincePeak);
      const kelly_multiplier = getKellyMultiplier(dd);

      const snapshot = {
        timestamp: String(tInput.timestamp ?? new Date().toISOString()),
        open_positions: Array.isArray(tInput.positions) ? tInput.positions.length : 0,
        unrealized_pnl: Number(tInput.unrealizedPnlPct ?? 0),
        drawdown_from_peak: dd,
        drawdown_velocity,
        kelly_multiplier,
        enp,
        active_breakers: [],
        warnings: [],
      };

      return { action_taken, result: snapshot, outcome_score: undefined };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'check_drawdown_limit') {
      const dd = Number(tInput.drawdownPct ?? 0);
      const kelly_multiplier = getKellyMultiplier(dd);
      const recovery_required = drawdownToRecoveryRequired(dd);
      return {
        action_taken,
        result: { kelly_multiplier, recovery_required },
        outcome_score: undefined,
      };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'detect_concentration') {
      const enp = computeENP((tInput.correlationMatrix ?? []) as number[][]);
      return { action_taken, result: { enp }, outcome_score: undefined };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'evaluate_circuit_breakers') {
      const snapshot = tInput.snapshot;
      const thresholds = tInput.thresholds ?? DEFAULT_THRESHOLDS;
      const res = evaluateCircuitBreakers(snapshot, thresholds);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'size_position') {
      const dd = Number(tInput.drawdownPct ?? 0);
      const baseKellySize = Number(tInput.baseKellySize ?? 0);
      const k = getKellyMultiplier(dd);
      const approved_size = k * baseKellySize;
      return {
        action_taken,
        result: { approved_size, kelly_fraction: k, reason: k > 0 ? 'ok' : 'halted_by_drawdown' },
        outcome_score: undefined,
      };
    }

    // Execution computations
    if (args.task.agent_role === 'execution' && args.task.task_type === 'evaluate_market_conditions') {
      const res = execIsTradeableMarket(tInput.spread, tInput.avg_spread, tInput.hoursToResolution);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'compute_position_size') {
      const slippage = execEstimateSlippage(tInput.openInterest);
      const res = execComputePositionSize(tInput.edgeEstimate, tInput.kelly_fraction, tInput.account_equity, slippage);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'place_limit_order') {
      // Guard 1: market conditions
      const cond = execIsTradeableMarket(tInput.spread, tInput.avg_spread, tInput.hoursToResolution);
      if (!cond.tradeable) return { action_taken, result: { placed: false, reason: cond.reason }, outcome_score: undefined };

      // Guard 2: risk approval required
      if (tInput.riskApprovedSize === null || tInput.riskApprovedSize === undefined) {
        return { action_taken, result: { placed: false, reason: 'missing_risk_approval' }, outcome_score: undefined };
      }

      const order = await placeOrder({
        order_id: null as any,
        bot_id: args.task.bot_id ?? 'execution-bot-1',
        market_ticker: tInput.ticker,
        order_type: 'limit' as any,
        side: tInput.side,
        size: tInput.riskApprovedSize,
        limit_price: tInput.limit_price,
        attempt_count: 1,
        openInterest: tInput.openInterest,
      });

      return { action_taken: { ...action_taken, order }, result: order as any, outcome_score: undefined };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'manage_open_position') {
      const o = tInput.order;
      const res = evaluateExit(o.fill_price, tInput.current_price, tInput.stop_level, tInput.profit_target, o.side);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'handle_partial_fill') {
      const res = handlePartialFill(tInput.order, tInput.currentSpread, tInput.avgSpread);
      return { action_taken, result: res, outcome_score: undefined };
    }

    // Strategy computations
    if (a.type === 'formalize_strategy') {
      const formalization = formalizeStrategy(tInput.finding);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, formalization) : undefined;
      return { action_taken: { ...action_taken, formalization }, result: formalization, outcome_score };
    }

    if (a.type === 'run_backtest') {
      const report = runBacktest(tInput.formalization, tInput.outcomes, tInput.slippage);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, report) : undefined;
      return { action_taken: { ...action_taken, report }, result: report as any, outcome_score };
    }

    if (a.type === 'detect_overfitting') {
      const res = detectOverfitting(tInput.report);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, res) : undefined;
      return { action_taken: { ...action_taken, overfit: res }, result: res, outcome_score };
    }

    if (a.type === 'walk_forward_analysis') {
      const res = computeWalkForwardWindows(tInput.outcomes, tInput.windowSize ?? 20);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, res) : undefined;
      return { action_taken: { ...action_taken, walk_forward: res }, result: res, outcome_score };
    }

    // CPI computations (Level 1)
    const url: string | undefined = a.dataset_url || tInput?.dataset?.url;
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
    const embedding = await embed(textToEmbed);

    const written = await writeEpisode({ episode: args.episode, embedding });

    return {
      episode_id: written.id,
      episode_written: true,
      semantic_updates: 0,
      procedure_updates: 0,
    };
  }
}

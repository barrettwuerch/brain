// THE BRAIN — Core loop skeleton (Phase 1 scaffold)
// STATE_CHECK → REASON → ACT → OBSERVE → REFLECT → STORE

import type { Episode, EpisodeOutcome, Task } from '../types';
import { grade, maxMoM, maxRow, parseCpi, trendLastN } from './level1_compute';
import { classifyMomentum, trendFromYesPrices, volumeAnomaly } from '../adapters/kalshi/compute';

import fs from 'node:fs/promises';
import { embed } from '../lib/embeddings';
import { supabaseAdmin } from '../lib/supabase';
import { readSimilarEpisodesRegimeAware } from './memory';
import { readSemanticFacts } from '../memory/semantic';
import { readProcedure } from '../memory/procedural';
import { writeEpisode } from '../memory/episodic';
import { checkStateBeforeRun } from '../behavioral/state_manager';
import { formatAndStoreFinding } from '../bots/research/research_output';
import { classifyMomentum as researchClassifyMomentum, detectVolumeAnomaly as researchDetectVolumeAnomaly, scanMarketTrend as researchScanMarketTrend, scoreRQS as researchScoreRQS } from '../bots/research/research_compute';
import { formalizeStrategy, detectOverfitting, computeWalkForwardWindows } from '../bots/strategy/strategy_compute';
import { classifyFundingRate as cryptoClassifyFundingRate, classifyVolatilityRegime as cryptoClassifyVolatilityRegime, computeRollingCorrelation as cryptoComputeRollingCorrelation } from '../adapters/alpaca/compute';
import { runBacktest } from '../bots/strategy/backtest_engine';
import { updateFindingStatus } from '../db/research_findings';
import { checkAndFireBreakers, DEFAULT_THRESHOLDS } from '../bots/risk/circuit_breakers';
import {
  handleAssessStrategicPriorities,
  handleGenerateDailyBrief,
  handleGenerateWeeklyMemo,
  handleDetectSystematicBlindSpots,
  handleGenerateDecisionPacket,
  handleReviewRegimeStrategyAlignment,
  handleEvaluateBottlenecks,
} from '../bots/cos/cos_handlers';
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
import { openPosition, closePosition, findOpenPositionByBotAndTicker, getOpenPositions, updatePositionPrice } from '../db/positions';
import { attributePerformance as intelligenceAttributePerformance } from '../bots/intelligence/attribution';
import { extractAndStoreFacts, pruneExpiredMemories } from '../bots/intelligence/consolidation';
import { generateFullDailyReport } from '../bots/intelligence/report_generator';
import { computeDeskPriorities } from '../bots/orchestrator/orchestrator_compute';
import { checkForCircuitBreakerEscalations, reviewAndTransitionBots, routeUnroutedFindings, runRegisterWatchConditions } from '../bots/orchestrator/routing';

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
  error_type?: 'computation_error' | 'strategy_error' | 'data_quality' | 'regime_mismatch' | 'unknown';
}

export interface StoreOutput {
  episode_id?: string;
  episode_written: boolean;
  semantic_updates: number;
  procedure_updates: number;
}

export class BrainLoop {
  private recentFailures: Episode[] = [];
  private lastFailureAtMs: number | null = null;

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
    // Recent-failures buffer housekeeping (within-session learning speed).
    if (this.recentFailures.length > 5) this.recentFailures = this.recentFailures.slice(0, 5);
    if (this.lastFailureAtMs && Date.now() - this.lastFailureAtMs > 30 * 60 * 1000) {
      this.recentFailures = [];
      this.lastFailureAtMs = null;
    }

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
    const episodic = await readSimilarEpisodesRegimeAware({ task_type: task.task_type, task_input: task.task_input, limit: 5 });
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
      refOut = { reflection_text: 'Reflection failed to run.', reasoning_score: 0.3, lessons: ['Fix reflection pipeline / prompt.'], error_type: 'unknown' };
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
      error_type: (obsOut.outcome === 'incorrect' ? (refOut.error_type ?? 'unknown') : null),
      ttl_days,
      embedding: null,
    };

    const storeOut = await this.store({ task, episode, reasonOut, refOut });
    // On success, mark task completed.
    await supabaseAdmin.from('tasks').update({ status: 'completed' }).eq('id', task.id);

    const storedEpisode = { ...episode, id: storeOut.episode_id ?? episode.id };

    // Strategy Bot: after run_backtest, update the linked research_finding status.
    if (task.agent_role === 'strategy' && (task.task_type === 'run_backtest' || task.task_type === 'run_crypto_backtest')) {
      try {
        const rep: any = actOut.result;
        const findingId = String(rep?.finding_id ?? '');
        const rec = String(rep?.recommendation ?? '');
        if (findingId) {
          if (rec === 'approved_for_forward_test' || rec === 'approved_with_caveats') {
            await supabaseAdmin.from('research_findings').update({ status: String(rec) }).eq('id', findingId);
            // For crypto, approved backtests should register watch conditions.
            try {
              const { data: frow } = await supabaseAdmin.from('research_findings').select('*').eq('id', findingId).maybeSingle();
              if (frow && String((frow as any).market_type ?? 'prediction') === 'crypto') {
                const { registerWatchConditions } = await import('../bots/orchestrator/routing');
                await registerWatchConditions([frow as any]);
              }
            } catch {}
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

    // Execution Bot: open/close real positions after episode UUID exists.
    if (task.agent_role === 'execution' && storeOut.episode_id) {
      try {
        if (task.task_type === 'place_limit_order' || task.task_type === 'place_crypto_limit_order') {
          const order = (actOut.result as any);
          if (order?.status === 'filled' || order?.status === 'partial') {
            const mt = String((task.task_input as any)?.market_type ?? (task.task_type === 'place_crypto_limit_order' ? 'crypto' : 'prediction')) as any;
            const sideRaw = String((task.task_input as any)?.side);
            // positions table currently uses yes/no; map crypto buy/sell into yes/no for storage
            const posSide = mt === 'crypto' ? (sideRaw === 'sell' ? 'no' : 'yes') : (sideRaw as any);

            const pos = await openPosition({
              bot_id: String(task.bot_id),
              desk: String(task.desk),
              market_type: mt,
              strategy_id: (task.task_input as any)?.strategy_id ?? null,
              market_ticker: String((task.task_input as any)?.ticker),
              status: 'open',
              side: posSide as any,
              entry_price: Number(order.fill_price),
              current_price: Number(order.fill_price),
              size: Number(order.fill_size),
              remaining_size: Number(order.fill_size),
              unrealized_pnl: 0,
              realized_pnl: 0,
              peak_price: Number(order.fill_price),
              stop_level: Number((task.task_input as any)?.stop_level),
              profit_target: Number((task.task_input as any)?.profit_target),
              slippage_assumed: Number(order.slippage ?? 0),
              closed_at: null,
              exit_price: null,
              exit_reason: null,
              entry_episode_id: storeOut.episode_id,
              exit_episode_id: null,
            });

            const lessons = Array.isArray(storedEpisode.lessons) ? [...storedEpisode.lessons] : [];
            lessons.push(`position_id:${pos.id}`);
            await supabaseAdmin.from('episodes').update({ lessons }).eq('id', storeOut.episode_id);
            storedEpisode.lessons = lessons;
          }
        }

        if (task.task_type === 'manage_open_position' || task.task_type === 'manage_crypto_position') {
          const t: any = task.task_input;
          const order = t.order;
          const evalRes = actOut.result as any;
          const ticker = String(order?.market_ticker ?? '');

          const pos = await findOpenPositionByBotAndTicker(String(task.bot_id), ticker);
          if (pos) {
            await updatePositionPrice(pos.id, Number(t.current_price));
          }

          if (evalRes?.action === 'exit' && pos) {
            const r = String(evalRes.reason ?? 'manual');
            const exitReason = r === 'profit_target_hit' ? 'profit_target' : r === 'stop_hit' ? 'stop_loss' : 'manual';
            await closePosition(pos.id, Number(t.current_price), exitReason as any, storeOut.episode_id);

            // Feedback loop: forward-test outcomes → strategy_outcomes → research_findings status.
            try {
              if (pos.strategy_id) {
                const strategyId = String(pos.strategy_id);
                const pnl = (Number(t.current_price) - Number(pos.entry_price)) * Number(pos.remaining_size) * (String(pos.side) === 'yes' ? 1 : -1);
                const won = pnl > 0;
                const domain = String(pos.market_type) === 'crypto' ? 'crypto' : 'prediction_markets';

                const { data: sf } = await supabaseAdmin
                  .from('semantic_facts')
                  .select('fact,last_updated')
                  .eq('domain', domain)
                  .order('last_updated', { ascending: false })
                  .limit(1)
                  .maybeSingle();

                const regime = sf ? String((sf as any).fact ?? '').slice(0, 32) : 'unknown';

                const { upsertStrategyOutcome } = await import('../db/strategy_outcomes');
                await upsertStrategyOutcome(strategyId, {
                  pnl,
                  won,
                  regime,
                  market_type: pos.market_type as any,
                  desk: String(pos.desk),
                });
                console.log(`[FEEDBACK] Trade closed for strategy ${strategyId}: pnl=${pnl.toFixed(4)} won=${won}`);
              }
            } catch (e: any) {
              console.error('[FEEDBACK] failed to upsert strategy_outcome:', e?.message ?? e);
            }

            const lessons = Array.isArray(storedEpisode.lessons) ? [...storedEpisode.lessons] : [];
            lessons.push(`position_closed:${pos.id}`);
            await supabaseAdmin.from('episodes').update({ lessons }).eq('id', storeOut.episode_id);
            storedEpisode.lessons = lessons;
          }
        }
      } catch (e: any) {
        console.error('[execution] position linkage failed:', e?.message ?? e);
      }
    }

    // Risk Bot: after evaluating circuit breakers, pause affected bots if any breach fired.
    // Gate 2 wiring: circuit breaker evaluation should be based on bot_states (current_drawdown),
    // because the Scanner also reads bot_states at fire time.
    if (task.agent_role === 'risk' && task.task_type === 'evaluate_circuit_breakers') {
      try {
        const { data, error } = await supabaseAdmin
          .from('bot_states')
          .select('bot_id')
          .neq('bot_id', 'risk-bot-1');
        if (error) throw error;
        const botIds = (data ?? []).map((r: any) => String(r.bot_id));

        const { checkAndFireBreakersFromBotStates } = await import('../bots/risk/circuit_breakers');
        await checkAndFireBreakersFromBotStates({ botIds });
      } catch (e: any) {
        console.error('[risk] checkAndFireBreakers failed:', e?.message ?? e);
      }
    }

    // Research Bot: format + store finding (needs stored episode UUID for supporting_episode_ids).
    // NOTE: only tasks that actually produce a ResearchFinding should enter this path.
    if (task.agent_role === 'research' && storeOut.episode_id) {
      const FINDING_TASK_TYPES = new Set([
        'market_trend_scan',
        'volume_anomaly_detect',
        'price_momentum_classify',
        'crypto_trend_scan',
        'crypto_volume_profile',
        'funding_rate_scan',
        'volatility_regime_detect',
        'correlation_scan',
        'generate_next_generation_hypothesis',
      ]);

      if (FINDING_TASK_TYPES.has(String(task.task_type))) {
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
    }

    return { episode: storedEpisode, store: storeOut };
  }

  async loadRoleSkill(agentRole?: string): Promise<string> {
    const skillPath = agentRole
      ? agentRole === 'chief_of_staff'
        ? new URL(`../bots/cos/COS_BOT_SKILL.md`, import.meta.url)
        : new URL(`../../skills/${agentRole.toUpperCase()}_BOT_SKILL.md`, import.meta.url)
      : new URL(`../../SKILL.md`, import.meta.url);

    try {
      return await fs.readFile(skillPath, 'utf8');
    } catch {
      const fallback = new URL(`../../SKILL.md`, import.meta.url);
      return await fs.readFile(fallback, 'utf8');
    }
  }

  /** REASON: decide what to do given task + retrieved memory. */
  async reason(input: ReasonInput): Promise<ReasonOutput> {
    // Phase 2: ReAct-style reasoner.

    const API_KEY_OPTIONAL_TASKS = ['propose_skill_update', 'generate_next_generation_hypothesis'];
    if (API_KEY_OPTIONAL_TASKS.includes(String(input.task.task_type)) && !String(process.env.ANTHROPIC_API_KEY ?? '').trim()) {
      return {
        chain_of_thought: 'No API key present — skipping LLM reasoning.',
        proposed_action: { type: String(input.task.task_type) },
        confidence: 0,
        uncertainty_flags: ['no_anthropic_key'],
      } as any;
    }
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

    // Inject recent failures from this session (priority budget: 300 tokens, carved out)
    let recentFailuresBlock = '';
    if (this.recentFailures.length > 0) {
      const lines: string[] = ['RECENT FAILURES THIS SESSION'];
      for (const f of this.recentFailures) {
        lines.push(`- task=${f.task_type} error_type=${f.error_type ?? 'unknown'}`);
        lines.push(`  reflection: ${String(f.reflection ?? '').slice(0, 400)}`);
      }
      recentFailuresBlock = lines.join('\n') + '\n\n';

      // enforce 300 token cap by dropping oldest entries first
      while (estimateTokens(recentFailuresBlock) > 300 && this.recentFailures.length > 0) {
        this.recentFailures.pop();
        const l2: string[] = ['RECENT FAILURES THIS SESSION'];
        for (const f of this.recentFailures) {
          l2.push(`- task=${f.task_type} error_type=${f.error_type ?? 'unknown'}`);
          l2.push(`  reflection: ${String(f.reflection ?? '').slice(0, 400)}`);
        }
        recentFailuresBlock = l2.join('\n') + '\n\n';
      }
    }

    let memoryContext = recentFailuresBlock + parts.map((p) => p.text).join('\n\n');

    // Knowledge Library injection (Block 4)
    try {
      const taskType = String(input.task.task_type ?? '');
      const deskRaw = String(input.task.desk ?? '');
      const desk = deskRaw.includes('crypto') ? 'crypto' : deskRaw.includes('prediction') ? 'prediction' : 'shared';

      const { data: kl, error: klErr } = await supabaseAdmin
        .from('knowledge_library')
        .select('title,content,source,domain')
        .in('domain', ['shared', desk])
        .limit(200);
      if (klErr) throw klErr;

      const applicable = (kl ?? []).filter((r: any) => {
        try {
          const meta = JSON.parse(String(r.source ?? '{}'));
          const applies: string[] = Array.isArray(meta?.applies_to) ? meta.applies_to : [];
          return applies.includes('all') || applies.includes(taskType);
        } catch {
          return false;
        }
      });

      // Compact injection: titles + content, capped.
      const titles = applicable.map((r: any) => String(r.title));


      const lines: string[] = [];
      lines.push('KNOWLEDGE LIBRARY:');
      for (const r of applicable) {
        lines.push(`- ${String((r as any).title)}`);
        lines.push(String((r as any).content ?? ''));
        lines.push('');
      }

      let klText = lines.join('\n');
      // Enforce a budget for knowledge injection.
      while (estimateTokens(klText) > 1200) {
        // drop the last chunk
        const idx = klText.lastIndexOf('\n- ');
        if (idx <= 0) break;
        klText = klText.slice(0, idx).trimEnd();
      }

      memoryContext = klText + '\n\n' + memoryContext;
    } catch (e: any) {
      console.warn('[KNOWLEDGE] injection failed:', e?.message ?? e);
    }

    const baseSystem = `You are THE BRAIN's REASON step. You must think before acting.\n\nReturn ONLY valid JSON with keys: chain_of_thought, proposed_action, confidence, uncertainty_flags.\n\nAllowed proposed_action shapes:\n- { \'type\': 'compute_max', dataset_url: string }\n- { \'type\': 'compute_max_mom_delta', dataset_url: string }\n- { \'type\': 'compute_trend_last_n', dataset_url: string, n: number }\n- { \'type\': 'scan_market_trend' }\n- { \'type\': 'detect_volume_anomaly' }\n- { \'type\': 'classify_price_momentum' }\n- { \'type\': 'score_rqs' }\n- { \'type\': 'monitor_positions' }\n- { \'type\': 'check_drawdown_limit' }\n- { \'type\': 'detect_concentration' }\n- { \'type\': 'evaluate_circuit_breakers' }\n- { \'type\': 'size_position' }\n- { \'type\': 'publish_regime_state' }\n- { \'type\': 'challenge_strategy' }\n- { \'type\': 'run_backtest' }\n- { \'type\': 'place_limit_order' }\n- { \'type\': 'manage_open_position' }\n- { \'type\': 'handle_partial_fill' }\n- { \'type\': 'evaluate_market_conditions' }\n- { \'type\': 'consolidate_memories' }\n- { \'type\': 'attribute_performance' }\n- { \'type\': 'generate_daily_report' }\n- { \'type\': 'prune_expired_memories' }\n- { \'type\': 'propose_skill_update' }\n- { \'type\': 'route_research_findings' }\n- { \'type\': 'review_bot_states' }\n- { \'type\': 'generate_priority_map' }\n- { \'type\': 'register_watch_conditions' }\n- { \'type\': 'funding_rate_scan' }\n- { \'type\': 'volatility_regime_detect' }\n- { \'type\': 'correlation_scan' }\n- { \'type\': 'generate_next_generation_hypothesis' }\n- { \'type\': 'validate_edge_mechanism' }\n- { \'type\': 'monitor_approved_findings' }\n- { \'type\': 'generate_weekly_report' }\n- { \'type\': 'review_dead_ends' }
- { \'type\': 'assess_strategic_priorities' }
- { \'type\': 'generate_daily_brief' }
- { \'type\': 'generate_weekly_memo' }
- { \'type\': 'detect_systematic_blind_spots' }
- { \'type\': 'generate_decision_packet' }
- { \'type\': 'review_regime_strategy_alignment' }
- { \'type\': 'evaluate_bottlenecks' }\n\nDo not include Observation; Observation is produced by ACT.`;

    const roleSkill = await this.loadRoleSkill(input.task.agent_role ?? undefined);
    const system = roleSkill + '\n\n---\n\n' + baseSystem;

    // Market context injection (Part B.4): only for Research Bot.
    let marketContextBlock = '';
    try {
      if (String(input.task.agent_role ?? '') === 'research') {
        const { computeResearchMarketContext } = await import('../bots/research/market_context');
        const ctx = await computeResearchMarketContext(input.task.task_input ?? {});
        marketContextBlock = `MARKET CONTEXT (derived metrics)\n${JSON.stringify(ctx)}\n\n`;
      }
    } catch (e: any) {
      console.warn('[research] market context injection failed:', e?.message ?? e);
    }

    const user = `${marketContextBlock}MEMORY CONTEXT\n${memoryContext}\n\nTASK\nTask type: ${input.task.task_type}\nTask input (JSON): ${JSON.stringify(input.task.task_input)}\n\nINSTRUCTIONS\nUse a ReAct-like structure internally: Thought -> Action (choose one).\nOutput must be JSON only.`;

    const testMode = String(process.env.BRAIN_TEST_MODE || '').toLowerCase() === 'true';

    const hasAnthropicKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0;
    if (!testMode && !hasAnthropicKey) {
      // Allow non-LLM tasks to proceed deterministically in environments without ANTHROPIC_API_KEY.
      if (input.task.task_type === 'propose_skill_update') {
        return {
          chain_of_thought: 'No ANTHROPIC_API_KEY; proceeding without LLM reasoning.',
          proposed_action: { type: 'propose_skill_update' },
          confidence: 0.5,
          uncertainty_flags: ['no_anthropic_key'],
        } as any;
      }
      if (input.task.task_type === 'generate_next_generation_hypothesis') {
        return {
          chain_of_thought: 'No ANTHROPIC_API_KEY; proceeding without LLM reasoning.',
          proposed_action: { type: 'generate_next_generation_hypothesis' },
          confidence: 0.5,
          uncertainty_flags: ['no_anthropic_key'],
        } as any;
      }
    }

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
      if (input.task.task_type === 'formalize_crypto_strategy') proposed_action = { type: 'formalize_strategy' };
      if (input.task.task_type === 'run_crypto_backtest') proposed_action = { type: 'run_backtest' };
      if (input.task.task_type === 'challenge_strategy') proposed_action = { type: 'challenge_strategy' };
      if (input.task.task_type === 'challenge_crypto_strategy') proposed_action = { type: 'challenge_strategy' };
      if (input.task.task_type === 'detect_overfitting') proposed_action = { type: 'detect_overfitting' };
      if (input.task.task_type === 'walk_forward_analysis') proposed_action = { type: 'walk_forward_analysis' };
      if (input.task.task_type === 'monitor_positions') proposed_action = { type: 'monitor_positions' };
      if (input.task.task_type === 'check_drawdown_limit') proposed_action = { type: 'check_drawdown_limit' };
      if (input.task.task_type === 'detect_concentration') proposed_action = { type: 'detect_concentration' };
      if (input.task.task_type === 'evaluate_circuit_breakers') proposed_action = { type: 'evaluate_circuit_breakers' };
      if (input.task.task_type === 'size_position') proposed_action = { type: 'size_position' };
      if (input.task.task_type === 'publish_regime_state') proposed_action = { type: 'publish_regime_state' };
      if (input.task.task_type === 'place_limit_order') proposed_action = { type: 'place_limit_order' };
      if (input.task.task_type === 'manage_open_position') proposed_action = { type: 'manage_open_position' };
      // compute_position_size is owned by Risk Bot (size_position task)
      // Execution Bot reads riskApprovedSize from task_input only
      // Execution Bot never computes its own approved size
      // See: src/bots/risk/risk_tasks.ts → size_position
      if (input.task.task_type === 'handle_partial_fill') proposed_action = { type: 'handle_partial_fill' };
      if (input.task.task_type === 'evaluate_market_conditions') proposed_action = { type: 'evaluate_market_conditions' };
      if (input.task.task_type === 'consolidate_memories') proposed_action = { type: 'consolidate_memories' };
      if (input.task.task_type === 'attribute_performance') proposed_action = { type: 'attribute_performance' };
      if (input.task.task_type === 'generate_daily_report') proposed_action = { type: 'generate_daily_report' };
      if (input.task.task_type === 'prune_expired_memories') proposed_action = { type: 'prune_expired_memories' };
      if (input.task.task_type === 'propose_skill_update') proposed_action = { type: 'propose_skill_update' };
      if (input.task.task_type === 'generate_next_generation_hypothesis') proposed_action = { type: 'generate_next_generation_hypothesis' };
      if (input.task.task_type === 'route_research_findings') proposed_action = { type: 'route_research_findings' };
      if (input.task.task_type === 'review_bot_states') proposed_action = { type: 'review_bot_states' };
      if (input.task.task_type === 'generate_priority_map') proposed_action = { type: 'generate_priority_map' };
      if (input.task.task_type === 'register_watch_conditions') proposed_action = { type: 'register_watch_conditions' };
      if (input.task.task_type === 'update_stale_watch_conditions') proposed_action = { type: 'update_stale_watch_conditions' };
      if (input.task.task_type === 'funding_rate_scan') proposed_action = { type: 'funding_rate_scan' };
      if (input.task.task_type === 'volatility_regime_detect') proposed_action = { type: 'volatility_regime_detect' };
      if (input.task.task_type === 'correlation_scan') proposed_action = { type: 'correlation_scan' };
      if (input.task.task_type === 'generate_next_generation_hypothesis') proposed_action = { type: 'generate_next_generation_hypothesis' };
      if (input.task.task_type === 'validate_edge_mechanism') proposed_action = { type: 'validate_edge_mechanism' };
      if (input.task.task_type === 'monitor_approved_findings') proposed_action = { type: 'monitor_approved_findings' };
      if (input.task.task_type === 'generate_weekly_report') proposed_action = { type: 'generate_weekly_report' };
      if (input.task.task_type === 'review_dead_ends') proposed_action = { type: 'review_dead_ends' };
      if (input.task.task_type === 'assess_strategic_priorities') proposed_action = { type: 'assess_strategic_priorities' };
      if (input.task.task_type === 'generate_daily_brief') proposed_action = { type: 'generate_daily_brief' };
      if (input.task.task_type === 'generate_weekly_memo') proposed_action = { type: 'generate_weekly_memo' };
      if (input.task.task_type === 'detect_systematic_blind_spots') proposed_action = { type: 'detect_systematic_blind_spots' };
      if (input.task.task_type === 'generate_decision_packet') proposed_action = { type: 'generate_decision_packet' };
      if (input.task.task_type === 'review_regime_strategy_alignment') proposed_action = { type: 'review_regime_strategy_alignment' };
      if (input.task.task_type === 'evaluate_bottlenecks') proposed_action = { type: 'evaluate_bottlenecks' };

      const skillPreview = roleSkill.split(/\r?\n/).slice(0, 5).join('\n');
      return {
        chain_of_thought:
          `ROLE SKILL (preview)\n${skillPreview}\n\n` +
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

    try {
      const parsed = extractFirstJsonObject(raw);
      return {
        chain_of_thought: String(parsed.chain_of_thought ?? ''),
        proposed_action: (parsed.proposed_action ?? { type: 'noop' }) as Record<string, any>,
        confidence: Number(parsed.confidence ?? 0.5),
        uncertainty_flags: Array.isArray(parsed.uncertainty_flags) ? parsed.uncertainty_flags.map(String) : [],
      };
    } catch (e: any) {
      // Robust fallback: if the model emits malformed JSON, do not crash the loop.
      // Use a safe, deterministic action mapping for the current task.
      console.warn('[REASON] JSON parse failed; falling back to safe action mapping:', e?.message ?? e);

      const t = String(input.task.task_type ?? '');
      let proposed_action: Record<string, any> = { type: 'noop' };
      const map: Record<string, Record<string, any>> = {
        market_trend_scan: { type: 'scan_market_trend' },
        crypto_trend_scan: { type: 'scan_market_trend' },
        volume_anomaly_detect: { type: 'detect_volume_anomaly' },
        crypto_volume_profile: { type: 'detect_volume_anomaly' },
        price_momentum_classify: { type: 'classify_price_momentum' },
        score_rqs: { type: 'score_rqs' },

        formalize_strategy: { type: 'formalize_strategy' },
        formalize_crypto_strategy: { type: 'formalize_strategy' },
        challenge_strategy: { type: 'challenge_strategy' },
        challenge_crypto_strategy: { type: 'challenge_strategy' },

        run_backtest: { type: 'run_backtest' },
        run_crypto_backtest: { type: 'run_backtest' },
        detect_overfitting: { type: 'detect_overfitting' },
        walk_forward_analysis: { type: 'walk_forward_analysis' },

        monitor_positions: { type: 'monitor_positions' },
        check_drawdown_limit: { type: 'check_drawdown_limit' },
        detect_concentration: { type: 'detect_concentration' },
        evaluate_circuit_breakers: { type: 'evaluate_circuit_breakers' },
        size_position: { type: 'size_position' },
        publish_regime_state: { type: 'publish_regime_state' },

        evaluate_market_conditions: { type: 'evaluate_market_conditions' },
        evaluate_crypto_market_conditions: { type: 'evaluate_crypto_market_conditions' },
        place_limit_order: { type: 'place_limit_order' },
        place_crypto_limit_order: { type: 'place_limit_order' },
        manage_open_position: { type: 'manage_open_position' },
        manage_crypto_position: { type: 'manage_open_position' },
        handle_partial_fill: { type: 'handle_partial_fill' },

        consolidate_memories: { type: 'consolidate_memories' },
        attribute_performance: { type: 'attribute_performance' },
        generate_daily_report: { type: 'generate_daily_report' },
        prune_expired_memories: { type: 'prune_expired_memories' },
        propose_skill_update: { type: 'propose_skill_update' },

        route_research_findings: { type: 'route_research_findings' },
        review_bot_states: { type: 'review_bot_states' },
        generate_priority_map: { type: 'generate_priority_map' },
        register_watch_conditions: { type: 'register_watch_conditions' },
        update_stale_watch_conditions: { type: 'update_stale_watch_conditions' },

        funding_rate_scan: { type: 'funding_rate_scan' },
        volatility_regime_detect: { type: 'volatility_regime_detect' },
        correlation_scan: { type: 'correlation_scan' },
        generate_next_generation_hypothesis: { type: 'generate_next_generation_hypothesis' },
        validate_edge_mechanism: { type: 'validate_edge_mechanism' },
        monitor_approved_findings: { type: 'monitor_approved_findings' },

        generate_weekly_report: { type: 'generate_weekly_report' },
        review_dead_ends: { type: 'review_dead_ends' },
        assess_strategic_priorities: { type: 'assess_strategic_priorities' },
        generate_daily_brief: { type: 'generate_daily_brief' },
        generate_weekly_memo: { type: 'generate_weekly_memo' },
        detect_systematic_blind_spots: { type: 'detect_systematic_blind_spots' },
        generate_decision_packet: { type: 'generate_decision_packet' },
        review_regime_strategy_alignment: { type: 'review_regime_strategy_alignment' },
        evaluate_bottlenecks: { type: 'evaluate_bottlenecks' },
      };

      if (map[t]) proposed_action = map[t];

      return {
        chain_of_thought: `FALLBACK: malformed JSON from LLM. Using safe action mapping for task_type=${t}.`,
        proposed_action,
        confidence: 0.4,
        uncertainty_flags: ['llm_json_parse_failed'],
      };
    }
  }

  /** ACT: execute the planned action (single step). */
  async act(args: { task: Task; reasonOut: ReasonOutput }): Promise<ActOutput> {
    const a = args.reasonOut.proposed_action || { type: 'noop' };

    const tInput: any = args.task.task_input || {};
    const action_taken = a;

    // Research computations (use frozen snapshot in task_input; no API calls here).
    // Note: Research task snapshots use `prices`, `currentVol`, `avgVol`.
    if (a.type === 'scan_market_trend') {
      const isResearch = args.task.agent_role === 'research' || ['market_trend_scan', 'crypto_trend_scan'].includes(args.task.task_type);
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
      const isResearch = args.task.agent_role === 'research' || ['volume_anomaly_detect', 'crypto_volume_profile'].includes(args.task.task_type);
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

    // Crypto research tasks
    if (args.task.agent_role === 'research' && args.task.task_type === 'funding_rate_scan') {
      const res = cryptoClassifyFundingRate(Number(tInput.rate ?? 0), Number(tInput.historical_avg ?? 0.0001));
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, res) : undefined;
      return { action_taken, result: res, outcome_score };
    }

    if (args.task.agent_role === 'research' && args.task.task_type === 'volatility_regime_detect') {
      const regime = cryptoClassifyVolatilityRegime(Number(tInput.realized_vol ?? 0));
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, regime) : undefined;
      return { action_taken, result: regime as any, outcome_score };
    }

    if (args.task.agent_role === 'research' && args.task.task_type === 'correlation_scan') {
      const corr = cryptoComputeRollingCorrelation((tInput.btc_prices ?? []).map(Number), (tInput.eth_prices ?? []).map(Number));
      const res = { correlation: corr, divergence: corr < 0.5 };
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, res) : undefined;
      return { action_taken, result: res, outcome_score };
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
      const desk = String(args.task.desk ?? 'prediction_markets');

      // FIX 2: Risk publishes regime every cycle (independent of Research Bot).
      try {
        if (desk === 'crypto_markets') {
          const { getCryptoOHLCV } = await import('../adapters/alpaca/data_feed');
          const { computeRealizedVol, classifyVolatilityRegime } = await import('../adapters/alpaca/compute');
          const bars = await getCryptoOHLCV('BTC/USD', '1d', 31);
          const closes = bars.map((b: any) => Number(b.close));
          const vol = computeRealizedVol(closes);
          const regime = classifyVolatilityRegime(vol);
          const published_at = new Date().toISOString();

          await supabaseAdmin.from('operational_state').upsert(
            {
              domain: 'regime_state',
              key: 'vol_regime',
              value: { vol_regime: regime, desk: 'crypto', published_at },
              published_by: 'risk-bot-1',
              published_at,
              ttl_seconds: 7200,
              expires_at: new Date(Date.now() + 7200 * 1000).toISOString(),
            },
            { onConflict: 'domain,key' },
          );
        }
      } catch {}

      const positions = await getOpenPositions(desk);

      if (!positions.length) {
        const snapshot = {
          timestamp: new Date().toISOString(),
          open_positions: 0,
          unrealized_pnl: 0,
          drawdown_from_peak: 0,
          drawdown_velocity: 0,
          kelly_multiplier: 1.0,
          enp: 0,
          active_breakers: [],
          warnings: [],
        };
        return { action_taken, result: snapshot, outcome_score: undefined };
      }

      // Ensure current_price is set (fallback to entry_price)
      const totalPeak = positions.reduce(
        (s, p) => s + Number((p.peak_price ?? p.entry_price)) * Number(p.remaining_size),
        0,
      );
      const totalCurrent = positions.reduce(
        (s, p) => s + Number((p.current_price ?? p.entry_price)) * Number(p.remaining_size),
        0,
      );
      const drawdownFromPeak = (totalPeak - totalCurrent) / Math.max(totalPeak, 1);

      // Correlation proxy: same ticker => 0.7, different => 0.2
      const n = positions.length;
      const corr: number[][] = [];
      for (let i = 0; i < n; i++) {
        const row: number[] = [];
        for (let j = 0; j < n; j++) {
          if (i === j) row.push(1);
          else row.push(positions[i].market_ticker === positions[j].market_ticker ? 0.7 : 0.2);
        }
        corr.push(row);
      }

      const enp = computeENP(corr);
      const kelly_multiplier = getKellyMultiplier(drawdownFromPeak);

      const snapshot = {
        timestamp: new Date().toISOString(),
        open_positions: positions.length,
        unrealized_pnl: positions.reduce((s, p) => s + Number(p.unrealized_pnl ?? 0), 0),
        drawdown_from_peak: drawdownFromPeak,
        drawdown_velocity: 0,
        kelly_multiplier,
        enp,
        active_breakers: [],
        warnings: [],
      };

      return { action_taken, result: snapshot, outcome_score: undefined };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'check_drawdown_limit') {
      const desk = String(args.task.desk ?? 'prediction_markets');
      const positions = await getOpenPositions(desk);

      if (!positions.length) {
        return { action_taken, result: { breached: false, current_pct: 0, threshold_pct: 0.15, action: 'none' }, outcome_score: undefined };
      }

      const totalPeak = positions.reduce(
        (s, p) => s + Number((p.peak_price ?? p.entry_price)) * Number(p.remaining_size),
        0,
      );
      const totalCurrent = positions.reduce(
        (s, p) => s + Number((p.current_price ?? p.entry_price)) * Number(p.remaining_size),
        0,
      );
      const dd = (totalPeak - totalCurrent) / Math.max(totalPeak, 1);
      return { action_taken, result: { breached: dd >= 0.15, current_pct: dd, threshold_pct: 0.15, action: dd >= 0.15 ? 'halt_all_trading' : 'none' }, outcome_score: undefined };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'detect_concentration') {
      const enp = computeENP((tInput.correlationMatrix ?? []) as number[][]);
      return { action_taken, result: { enp }, outcome_score: undefined };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'evaluate_circuit_breakers') {
      // This task is now primarily a *trigger* for evaluating bot_states-driven breakers in the runner.
      // Still support the legacy snapshot mode for ad-hoc testing.
      const snapshot = (tInput as any)?.snapshot;
      if (!snapshot) {
        return { action_taken, result: { breacheds: [], actions: [] }, outcome_score: undefined };
      }
      const thresholds = (tInput as any)?.thresholds ?? DEFAULT_THRESHOLDS;
      const res = evaluateCircuitBreakers(snapshot, thresholds);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'size_position') {
      const dd = Number(tInput.drawdownPct ?? 0);
      const baseKellySize = Number(tInput.baseKellySize ?? 0);
      const k = getKellyMultiplier(dd);
      const approved_size = k * baseKellySize;

      // Continuation support: size_position → place_limit_order
      // If approved_size is zeroed by drawdown tiers, do not seed continuation.
      try {
        const cont = (tInput as any)?.continuation;
        if (cont && approved_size > 0) {
          const { task_type, agent_role, bot_id, desk, task_input } = cont;
          if (!task_type || !bot_id || !task_input?.symbol || !task_input?.side || !task_input?.limitPrice) {
            console.error('size_position continuation malformed, skipping', cont);
          } else {
            const { error: insErr } = await supabaseAdmin.from('tasks').insert({
              task_type,
              task_input: {
                ...task_input,
                riskApprovedSize: approved_size,
              },
              status: 'queued',
              tags: ['risk', 'continuation', 'sized'],
              agent_role,
              desk,
              bot_id,
            });
            if (insErr) throw insErr;
            console.log('[RISK] Seeded continuation task', { task_type, bot_id, approved_size });
          }
        }
      } catch (e: any) {
        // Do not crash risk sizing on continuation errors.
        console.error('[RISK] size_position continuation error (skipping):', e?.message ?? e);
      }

      return {
        action_taken,
        result: { approved_size, kelly_fraction: k, reason: k > 0 ? 'ok' : 'halted_by_drawdown' },
        outcome_score: undefined,
      };
    }

    if (args.task.agent_role === 'risk' && args.task.task_type === 'publish_regime_state') {
      const desk = String(tInput.desk ?? 'prediction');
      const published_at = new Date().toISOString();
      let regime: 'low' | 'normal' | 'elevated' | 'extreme' = 'normal';

      if (desk === 'crypto') {
        const { getCryptoOHLCV } = await import('../adapters/alpaca/data_feed');
        const { computeRealizedVol, classifyVolatilityRegime } = await import('../adapters/alpaca/compute');
        const bars = await getCryptoOHLCV('BTC/USD', '1d', 31);
        const closes = bars.map((b: any) => Number(b.close));
        const vol = computeRealizedVol(closes);
        regime = classifyVolatilityRegime(vol) as any;

        await supabaseAdmin.from('operational_state').upsert(
          {
            domain: 'regime_state',
            key: 'vol_regime',
            value: { vol_regime: regime, desk: 'crypto', published_at },
            published_by: 'risk-bot-1',
            published_at,
            ttl_seconds: 7200,
            expires_at: new Date(Date.now() + 7200 * 1000).toISOString(),
          },
          { onConflict: 'domain,key' },
        );

        console.log(`[REGIME] Published crypto regime=${regime} valid for 2h`);
        return { action_taken, result: { desk, regime, published_at, ttl_hours: 2 }, outcome_score: 1 };
      }

      // prediction desk: default to normal (no live VIX data in test mode)
      regime = 'normal';
      await supabaseAdmin.from('operational_state').upsert(
        {
          domain: 'regime_state',
          key: 'vol_regime',
          value: { vol_regime: regime, desk: 'prediction', published_at },
          published_by: 'risk-bot-1',
          published_at,
          ttl_seconds: 7200,
          expires_at: new Date(Date.now() + 7200 * 1000).toISOString(),
        },
        { onConflict: 'domain,key' },
      );

      console.log('[REGIME] Published prediction regime=normal (default — no live VIX data in test mode)');
      return { action_taken, result: { desk, regime, published_at, ttl_hours: 2 }, outcome_score: 1 };
    }

    // Execution computations
    if (args.task.agent_role === 'execution' && args.task.task_type === 'evaluate_market_conditions') {
      const res = execIsTradeableMarket(tInput.spread, tInput.avg_spread, tInput.hoursToResolution);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'evaluate_crypto_market_conditions') {
      const { isCryptoTradeable } = await import('../adapters/alpaca/compute');
      const res = isCryptoTradeable(String(tInput.ticker), String(tInput.volRegime ?? 'normal'), Number(tInput.spreadPct ?? 0));
      return { action_taken, result: res, outcome_score: undefined };
    }

    // compute_position_size is owned by Risk Bot (size_position task)
    // Execution Bot reads riskApprovedSize from task_input only
    // Execution Bot never computes its own approved size
    // See: src/bots/risk/risk_tasks.ts → size_position

    if (args.task.agent_role === 'execution' && args.task.task_type === 'place_limit_order') {
      const earlyExit = (reason: string, details?: any) => {
        return {
          action_taken,
          result: { placed: false, reason, details: details ?? null },
          outcome_score: undefined,
        };
      };

      // Guard 0: bot must be in a tradeable state right now.
      const { data: botState, error: bsErr } = await supabaseAdmin
        .from('bot_states')
        .select('current_state,current_drawdown')
        .eq('bot_id', String(args.task.bot_id ?? 'execution-bot-1'))
        .maybeSingle();
      if (bsErr) throw bsErr;

      const curState = String((botState as any)?.current_state ?? 'exploiting');
      const curDrawdown = Number((botState as any)?.current_drawdown ?? 0);

      if (!['exploiting', 'cautious'].includes(curState)) {
        return earlyExit('bot_not_in_tradeable_state', { current_state: curState });
      }

      // Guard: drawdown kill switch (> 0.20 means Kelly=0, no orders).
      if (curDrawdown > 0.2) {
        return earlyExit('halted_by_drawdown', { current_drawdown: curDrawdown });
      }

      // Guard 1: market conditions (only if fields provided)
      if (
        tInput.spread !== undefined &&
        tInput.avg_spread !== undefined &&
        tInput.hoursToResolution !== undefined
      ) {
        const cond = execIsTradeableMarket(tInput.spread, tInput.avg_spread, tInput.hoursToResolution);
        if (!cond.tradeable) return earlyExit(cond.reason);
      }

      // Guard 2: risk approval required
      if (tInput.riskApprovedSize === null || tInput.riskApprovedSize === undefined) {
        return earlyExit('missing_risk_approval');
      }

      const qty = Number(tInput.riskApprovedSize);
      if (!Number.isFinite(qty) || qty <= 0) {
        return earlyExit('halted_by_drawdown', { riskApprovedSize: tInput.riskApprovedSize });
      }

      // Place real Alpaca paper order. Tag with client_order_id = task.id for reconciliation.
      const { placeOrder: alpacaPlaceOrder } = await import('../lib/alpaca');

      const symbol = String(tInput.symbol ?? tInput.ticker ?? '').trim();
      if (!symbol) return earlyExit('missing_symbol');

      const limitPrice = Number(tInput.limitPrice ?? tInput.limit_price);
      if (!Number.isFinite(limitPrice) || limitPrice <= 0) return earlyExit('missing_limit_price');

      const side = String(tInput.side ?? '').toLowerCase();
      if (side !== 'buy' && side !== 'sell') return earlyExit('invalid_side', { side });

      const order = await alpacaPlaceOrder({
        symbol,
        qty: String(Math.floor(qty)),
        side: side as any,
        type: 'limit',
        time_in_force: 'gtc',
        limit_price: String(limitPrice),
        client_order_id: String(args.task.id),
      });

      return {
        action_taken: {
          ...action_taken,
          order: {
            order_id: order.id,
            client_order_id: order.client_order_id,
            approved_qty: Math.floor(qty),
            status: order.status,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            time_in_force: order.time_in_force,
            limit_price: order.limit_price ?? null,
          },
        },
        result: { placed: true, order_id: order.id, client_order_id: order.client_order_id, approved_qty: Math.floor(qty) },
        outcome_score: undefined,
      };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'manage_open_position') {
      const o = tInput.order;
      const fill = Number(o.fill_price);
      const cur = Number(tInput.current_price);
      const side = String(o.side);
      const isLong = side === 'yes' || side === 'buy';
      const unrealized = (cur - fill) * (isLong ? 1 : -1);

      const hoursToResolution = Number(tInput.hoursToResolution ?? 999);

      // Near resolution, in profit — take the win.
      if (hoursToResolution < 6 && unrealized > 0) {
        console.log(`[EXECUTION] Near-resolution exit: ${hoursToResolution}h remaining, pnl=${unrealized.toFixed(4)}, taking profit`);
        return { action_taken, result: { action: 'exit', reason: 'near_resolution_take_profit' }, outcome_score: undefined };
      }

      // Tighten stop when approaching resolution (evaluation-only; do not persist).
      let stop = Number(tInput.stop_level);
      if (hoursToResolution < 48) {
        const tightStop = fill + (stop - fill) * 0.5;
        console.log(`[EXECUTION] Tightened stop to ${tightStop.toFixed(4)} (${hoursToResolution}h to resolution)`);
        stop = tightStop;
      }

      const res = evaluateExit(fill, cur, stop, Number(tInput.profit_target), side as any);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'manage_crypto_position') {
      const o = tInput.order;
      const fill = Number(o.fill_price);
      const cur = Number(tInput.current_price);
      const side = String(o.side);
      const isLong = side === 'yes' || side === 'buy';
      const unrealized = (cur - fill) * (isLong ? 1 : -1);

      const { findOpenPositionByBotAndTicker } = await import('../db/positions');
      const pos = await findOpenPositionByBotAndTicker(String(args.task.bot_id), String(o.market_ticker));

      const maxHoldDays = Number(tInput.max_hold_days ?? 7);
      const createdAt = pos ? new Date(String((pos as any).created_at)).getTime() : Date.now();
      const holdDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
      const holdPct = holdDays / Math.max(maxHoldDays, 1e-9);

      if (holdPct >= 0.8 && unrealized > 0) {
        console.log(`[EXECUTION] Approaching max hold (${holdDays.toFixed(2)}d / ${maxHoldDays}d), pnl positive — taking profit`);
        return { action_taken, result: { action: 'exit', reason: 'max_hold_approaching_take_profit' }, outcome_score: undefined };
      }

      const res = evaluateExit(fill, cur, Number(tInput.stop_level), Number(tInput.profit_target), side as any);
      return { action_taken, result: res, outcome_score: undefined };
    }

    if (args.task.agent_role === 'execution' && args.task.task_type === 'handle_partial_fill') {
      const res = handlePartialFill(tInput.order, tInput.currentSpread, tInput.avgSpread);
      return { action_taken, result: res, outcome_score: undefined };
    }

    // Chief of Staff (CoS) computations
    if (args.task.agent_role === 'chief_of_staff') {
      const db = supabaseAdmin;

      const r: any = await (async () => {
        switch (String(args.task.task_type)) {
          case 'assess_strategic_priorities':
            return await handleAssessStrategicPriorities(args.task, db);
          case 'generate_daily_brief':
            return await handleGenerateDailyBrief(args.task, db);
          case 'generate_weekly_memo':
            return await handleGenerateWeeklyMemo(args.task, db);
          case 'detect_systematic_blind_spots':
            return await handleDetectSystematicBlindSpots(args.task, db);
          case 'generate_decision_packet':
            return await handleGenerateDecisionPacket(args.task, db);
          case 'review_regime_strategy_alignment':
            return await handleReviewRegimeStrategyAlignment(args.task, db);
          case 'evaluate_bottlenecks':
            return await handleEvaluateBottlenecks(args.task, db);
          default:
            return { observation: { ok: false, error: 'unknown_cos_task' }, outcome_score: 0 };
        }
      })();

      // CoS handlers return {observation,outcome_score}; normalize to ActOutput.
      return {
        action_taken,
        result: (r?.observation ?? {}) as any,
        outcome_score: typeof r?.outcome_score === 'number' ? r.outcome_score : undefined,
      };
    }

    // Intelligence computations
    if (args.task.agent_role === 'intelligence' && args.task.task_type === 'consolidate_memories') {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabaseAdmin.from('episodes').select('*').gte('created_at', cutoff);
      if (error) throw error;
      const stored = await extractAndStoreFacts((data ?? []) as any);
      return { action_taken, result: stored, outcome_score: undefined };
    }

    if (args.task.agent_role === 'intelligence' && args.task.task_type === 'attribute_performance') {
      const out = await intelligenceAttributePerformance();
      return { action_taken, result: out, outcome_score: undefined };
    }

    if (args.task.agent_role === 'intelligence' && args.task.task_type === 'generate_daily_report') {
      const report = await generateFullDailyReport();
      return { action_taken, result: { ok: true, reportLen: report.length }, outcome_score: undefined };
    }

    if (args.task.agent_role === 'intelligence' && args.task.task_type === 'prune_expired_memories') {
      const out = await pruneExpiredMemories();
      return { action_taken, result: out, outcome_score: undefined };
    }

    if (args.task.agent_role === 'intelligence' && args.task.task_type === 'aggregate_challenge_calibration') {
      const { aggregateMonthlyChallengeCalibration } = await import('../bots/intelligence/challenge_calibration');
      const report_month = String((tInput as any).report_month ?? '').trim();
      const out = await aggregateMonthlyChallengeCalibration({ reportMonth: report_month || undefined });
      return { action_taken, result: out as any, outcome_score: undefined };
    }

    if (args.task.agent_role === 'intelligence' && args.task.task_type === 'generate_weekly_report') {
      const fs = await import('node:fs');
      const path = await import('node:path');

      const window_days = Number(tInput.window_days ?? 7);

      const reportsDir = path.join(process.cwd(), 'reports');
      const names = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir) : [];
      const daily = names
        .filter((n: string) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(n))
        .sort();

      const lastN = daily.slice(-window_days);
      const blobs = lastN.map((n: string) => fs.readFileSync(path.join(reportsDir, n), 'utf8'));
      const range = lastN.length ? `${lastN[0].replace('.txt', '')} → ${lastN[lastN.length - 1].replace('.txt', '')}` : 'n/a';

      // Simple trajectory heuristic: compare count of "NEEDS ATTENTION" lines and strategy underperforming.
      const attentionCounts = blobs.map((b: string) => (b.match(/NEEDS ATTENTION/g) || []).length);
      const thisWeekAttention = attentionCounts.reduce((a: number, b: number) => a + b, 0);

      const now = new Date();
      const weekNum = String(Math.ceil((((+now - +new Date(now.getFullYear(), 0, 1)) / 86400000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)).padStart(2, '0');
      const outDir = path.join(reportsDir, 'weekly');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${now.getUTCFullYear()}-W${weekNum}.txt`);

      const lines: string[] = [];
      lines.push(`WEEKLY SYNTHESIS — Week W${weekNum}, ${range}`);
      lines.push('══════════════════════════════════════════');
      lines.push('TRAJECTORY');
      lines.push(`Overall: STABLE`);
      lines.push(`Based on: ${thisWeekAttention} attention flags across ${lastN.length} daily reports`);
      lines.push('');
      lines.push('ATTENTION ITEMS');
      if (!blobs.length) lines.push('(none)');
      else {
        for (const b of blobs) {
          const m = b.split('\n').filter((l) => l.startsWith('- '));
          for (const l of m.slice(0, 5)) lines.push(l);
        }
      }
      lines.push('');

      fs.writeFileSync(outPath, lines.join('\n'));

      return { action_taken, result: { ok: true, path: outPath }, outcome_score: 1 };
    }

    if (args.task.agent_role === 'intelligence' && args.task.task_type === 'propose_skill_update') {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const target_role = String((tInput as any).target_role ?? 'research');
      const skill_file = String((tInput as any).skill_file ?? `skills/${target_role.toUpperCase()}_BOT_SKILL.md`);
      const min_conf = Number((tInput as any).min_confidence_threshold ?? 0.75);
      const min_facts = Number((tInput as any).min_facts_required ?? 5);

      const skillPath = path.join(process.cwd(), skill_file);
      const skillContent = await fs.readFile(skillPath, 'utf8');

      const domains = Array.from(new Set([target_role, 'crypto', 'prediction_markets']));
      const { data: facts, error } = await supabaseAdmin
        .from('semantic_facts')
        .select('fact,confidence,domain')
        .gte('confidence', min_conf)
        .in('domain', domains)
        .order('confidence', { ascending: false })
        .limit(20);
      if (error) throw error;

      const topFacts = (facts ?? []).map((f: any) => String(f.fact));

      if (topFacts.length < min_facts) {
        return {
          action_taken,
          result: {
            status: 'insufficient_facts',
            facts_found: topFacts.length,
            required: min_facts,
            message: 'Not enough high-confidence facts to propose update. Check back later.',
          },
          outcome_score: undefined,
        };
      }

      const prompt =
        `You are reviewing the procedural instructions for the ${target_role} bot.\n\n` +
        `Here is the current SKILL.md content:\n\n${skillContent}\n\n` +
        `Here are the top semantic facts this bot has accumulated with high confidence:\n\n` +
        `${topFacts.map((f) => `- ${f}`).join('\n')}\n\n` +
        `Your job: identify any facts that (a) contradict current instructions, (b) significantly extend or refine current instructions, or (c) represent new knowledge not covered at all.\n` +
        `For each: quote the relevant SKILL.md section, explain the conflict or extension, and write a proposed replacement or addition.\n` +
        `Be surgical — only propose changes that are clearly supported by multiple high-confidence facts.\n` +
        `If the SKILL.md already reflects the accumulated knowledge well, say so and propose no changes.\n\n` +
        `Return ONLY valid JSON with keys: changes_proposed (boolean), proposals (array), no_changes_reason (string|null).\n` +
        `Each proposal: { section: string, issue: 'contradiction'|'extension'|'new_knowledge', proposed_change: string, supporting_facts: string[] }.\n`;

      const key = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
      if (!key) {
        return {
          action_taken,
          result: {
            status: 'no_api_key',
            target_role,
            skill_file,
            facts_found: topFacts.length,
            message: 'Missing env ANTHROPIC_API_KEY — cannot propose skill update in this environment.',
          },
          outcome_score: undefined,
        };
      }

      const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic.js');
      const text = await claudeText({ system: 'You are a careful editor. Be conservative.', user: prompt, maxTokens: 1200 });
      const parsed = extractFirstJsonObject(text) ?? {};

      const proposals = Array.isArray((parsed as any).proposals) ? (parsed as any).proposals : [];
      const changes_proposed = Boolean((parsed as any).changes_proposed) && proposals.length > 0;

      const result = {
        target_role,
        skill_file,
        changes_proposed,
        proposal_count: proposals.length,
        proposals,
        no_changes_reason: (parsed as any).no_changes_reason ?? null,
      };

      if (changes_proposed) {
        console.log('╔══════════════════════════════════╗');
        console.log('║ SKILL UPDATE PROPOSED            ║');
        console.log(`║ Role: ${target_role.padEnd(27)}║`);
        console.log(`║ ${String(proposals.length).padEnd(2)} change(s) proposed           ║`);
        console.log('║ Requires Managing Partner        ║');
        console.log('║ review before any SKILL.md       ║');
        console.log('║ is modified.                     ║');
        console.log('╚══════════════════════════════════╝');
      }

      return { action_taken, result, outcome_score: undefined };
    }

    // Research computations (event-triggered)
    if (args.task.agent_role === 'research' && args.task.task_type === 'generate_next_generation_hypothesis') {
      const key = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
      const failedId = String(tInput.failed_finding_id ?? '');
      if (!failedId) return { action_taken, result: { status: 'incomplete_finding', reason: 'missing_failed_finding_id', failed_finding_id: null }, outcome_score: 0.5 };

      if (!key) {
        return {
          action_taken,
          result: { status: 'no_api_key', failed_finding_id: failedId, message: 'Missing env ANTHROPIC_API_KEY — cannot generate next-gen hypothesis.' },
          outcome_score: 0.5,
        };
      }

      const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic.js');
      const { scoreRQS, validateSixQuestions } = await import('../bots/research/research_compute');

      const { data: failed, error: fErr } = await supabaseAdmin.from('research_findings').select('*').eq('id', failedId).single();
      if (fErr) throw fErr;

      const domain = String((failed as any).market_type) === 'crypto' ? 'crypto' : 'prediction_markets';
      const { data: facts } = await supabaseAdmin
        .from('semantic_facts')
        .select('fact,confidence,domain')
        .or(`domain.eq.${domain},domain.eq.${String((failed as any).agent_role ?? 'research')}`)
        .gte('confidence', 0.6)
        .order('last_updated', { ascending: false })
        .limit(10);

      const prompt =
        `The following trading strategy was tried and failed. Here is what we know about it:\n` +
        `DESCRIPTION: ${String((failed as any).description ?? '')}\n` +
        `MECHANISM: ${String((failed as any).mechanism ?? '')}\n` +
        `FAILURE_CONDITIONS: ${String((failed as any).failure_conditions ?? '')}\n\n` +
        `Here are the failure patterns we've accumulated about why it didn't work:\n` +
        `${(facts ?? []).map((r: any) => `- ${String(r.fact)}`).join('\n')}\n\n` +
        `Your job: propose a next-generation hypothesis that directly addresses the identified failure conditions.\n` +
        `The new hypothesis must: (a) explain explicitly how it differs from the failed approach, (b) explain why the mechanism would survive the conditions that killed the parent strategy, (c) identify what new failure conditions to watch for.\n` +
        `Format your output as JSON with keys: edge_type, description, mechanism, failure_conditions, market, regime_notes, rqs_components.\n` +
        `Use the six-question standard (provide a complete narrative).\n`;

      const text = await claudeText({ system: 'You are a research strategist. Be concrete and falsifiable.', user: prompt, maxTokens: 900 });
      const parsed = extractFirstJsonObject(text) ?? {};

      const draft: any = {
        bot_id: String(args.task.bot_id ?? (String((failed as any).market_type) === 'crypto' ? 'crypto-research-bot-1' : 'research-bot-1')),
        desk: String(args.task.desk ?? (String((failed as any).market_type) === 'crypto' ? 'crypto_markets' : 'prediction_markets')),
        market_type: String(tInput.market_type ?? (failed as any).market_type ?? 'prediction'),
        agent_role: 'research',

        finding_type: 'preliminary',
        edge_type: parsed.edge_type,

        description: parsed.description,
        mechanism: parsed.mechanism,
        failure_conditions: parsed.failure_conditions,
        market: parsed.market ?? (failed as any).market,
        regime_notes: parsed.regime_notes ?? null,

        rqs_components: parsed.rqs_components ?? null,
        sample_size: null,
        observed_rate: null,
        base_rate: 0.5,
        lift: null,
        out_of_sample: false,

        status: 'preliminary',
        recommendation: 'investigate_further',
        backtest_result: null,
        supporting_episode_ids: [],
        notes: `Next-gen hypothesis generated from failed finding ${failedId}.`,
        parent_finding_id: failedId,
      };

      const v = validateSixQuestions(draft);
      if (!v.valid) {
        return {
          action_taken,
          result: { status: 'incomplete_finding', reason: 'LLM output missing required fields', failed_finding_id: failedId },
          outcome_score: 0.5,
        };
      }

      const rqs_score = draft.rqs_components ? scoreRQS(draft.rqs_components) : null;

      const { data: created, error: cErr } = await supabaseAdmin
        .from('research_findings')
        .insert({
          ...draft,
          rqs_score,
          parent_finding_id: failedId,
        })
        .select('id')
        .single();
      if (cErr) throw cErr;

      console.log(`[NEXT-GEN] Created hypothesis ${String((created as any).id)} from failed strategy ${failedId}`);
      return {
        action_taken,
        result: { status: 'created', new_finding_id: String((created as any).id), parent_finding_id: failedId },
        outcome_score: 0.5,
      };
    }

    // Research monitoring / validation
    if (args.task.agent_role === 'research' && args.task.task_type === 'validate_edge_mechanism') {
      const key = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
      if (!key) {
        return { action_taken, result: { status: 'no_api_key' }, outcome_score: 0.5 };
      }

      const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic.js');
      const finding_id = String(tInput.finding_id ?? '');
      const mechanism = String(tInput.mechanism ?? '');

      const prompt =
        `A trading edge has been proposed with this mechanism: [${mechanism}].\n\n` +
        `Your job is to stress-test whether this mechanism is real or a post-hoc rationalization of a pattern. Answer:\n` +
        `1. What would have to be true in the market for this mechanism to hold? Are those conditions verifiable?\n` +
        `2. Find at least one counter-argument or counter-example. Under what conditions does the mechanism break?\n` +
        `3. Is this mechanism distinguishable from randomness? What's the falsifiability criterion?\n\n` +
        `Rate the mechanism: strong | moderate | weak | unsupported.\n\n` +
        `Return ONLY JSON: { mechanism_strength, counter_evidence, confidence_adjustment }. confidence_adjustment in [-0.3, +0.1].`;

      const text = await claudeText({ system: 'You are a hostile reviewer.', user: prompt, maxTokens: 800 });
      const parsed: any = extractFirstJsonObject(text) ?? {};

      const strength = String(parsed.mechanism_strength ?? 'moderate');
      const adjustment = Math.max(-0.3, Math.min(0.1, Number(parsed.confidence_adjustment ?? 0)));

      if (finding_id) {
        const { data: f } = await supabaseAdmin.from('research_findings').select('rqs_score').eq('id', finding_id).maybeSingle();
        const cur = f ? Number((f as any).rqs_score ?? 0) : 0;
        const next = Math.max(0, Math.min(1, cur + adjustment));
        await supabaseAdmin.from('research_findings').update({ rqs_score: next }).eq('id', finding_id);
        if (strength === 'unsupported') {
          await updateFindingStatus(finding_id, 'archived');
          console.log(`[MECHANISM] Finding ${finding_id} archived — mechanism unsupported`);
        } else {
          console.log(`[MECHANISM] Finding ${finding_id} mechanism=${strength} rqs adjusted by ${adjustment}`);
        }
      }

      return {
        action_taken,
        result: {
          mechanism_strength: strength,
          counter_evidence: Array.isArray(parsed.counter_evidence) ? parsed.counter_evidence.map(String) : [],
          confidence_adjustment: adjustment,
        },
        outcome_score: 0.6,
      };
    }

    if (args.task.agent_role === 'research' && args.task.task_type === 'monitor_approved_findings') {
      const market_type = String(tInput.market_type ?? 'prediction');
      const { data: findings, error } = await supabaseAdmin
        .from('research_findings')
        .select('id,status,finding_type,market,market_type,description')
        .in('status', ['approved_for_live', 'in_backtest', 'passed_to_backtest'])
        .eq('market_type', market_type)
        .limit(10);
      if (error) throw error;

      const degraded: any[] = [];
      for (const f of findings ?? []) {
        // In test mode, no live comparison; degradation is unknown.
        const score = 0;
        if (score > 0.7) {
          await updateFindingStatus(String((f as any).id), 'under_investigation');
          degraded.push({ finding_id: String((f as any).id), degradation_score: score, condition_change: 'n/a' });
          console.log(`[MONITOR] Finding ${(f as any).id} degraded (${score}) — returned to investigation`);
        }
      }

      const report = {
        findings_checked: (findings ?? []).length,
        degraded,
        healthy: (findings ?? []).length - degraded.length,
      };

      return { action_taken, result: report, outcome_score: degraded.length ? 1 : 0.6 };
    }

    // Orchestrator computations
    if (args.task.agent_role === 'orchestrator' && args.task.task_type === 'review_dead_ends') {
      const lookback = Number(tInput.lookback_days ?? 90);
      const threshold = Number(tInput.cluster_threshold ?? 3);
      const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabaseAdmin
        .from('research_findings')
        .select('id,finding_type,market_type,description,created_at,rqs_score')
        .eq('status', 'archived')
        .lt('rqs_score', 0.65)
        .gte('created_at', since)
        .limit(500);
      if (error) throw error;

      const clusters = new Map<string, any[]>();
      for (const f of data ?? []) {
        const key = `${String((f as any).finding_type)}::${String((f as any).market_type)}`;
        const arr = clusters.get(key) ?? [];
        arr.push(f);
        clusters.set(key, arr);
      }

      const alerts: string[] = [];
      const clusterOut: any[] = [];

      for (const [key, items] of clusters.entries()) {
        const [finding_type, market_type] = key.split('::');
        const count = items.length;
        const pattern_alert = count >= threshold;
        if (pattern_alert) {
          const samples = items.slice(0, 3).map((x: any) => String(x.description ?? '').slice(0, 80));
          alerts.push(
            `[DEAD END PATTERN] ${count} ${finding_type} findings failed RQS in ${market_type} — possible systematic blind spot or unviable edge category. Sample failure reasons: ${samples.join(' | ')}`,
          );
        }
        clusterOut.push({ finding_type, market_type, count, pattern_alert });
      }

      if (alerts.length) console.log(`[DEAD ENDS] ${alerts.length} pattern alerts generated`);
      return { action_taken, result: { total_reviewed: (data ?? []).length, clusters: clusterOut, alerts }, outcome_score: 1 };
    }

    if (args.task.agent_role === 'orchestrator' && args.task.task_type === 'update_stale_watch_conditions') {
      const { updateStaleWatchConditions } = await import('../bots/orchestrator/routing');
      const n = await updateStaleWatchConditions();
      return { action_taken, result: { flagged: n }, outcome_score: 1 };
    }

    if (args.task.agent_role === 'orchestrator' && args.task.task_type === 'route_research_findings') {
      const routed = await routeUnroutedFindings();
      if (routed > 0) console.log(`[ORCHESTRATOR] Routed ${routed} findings to Strategy`);
      return { action_taken, result: { routed }, outcome_score: undefined };
    }

    if (args.task.agent_role === 'orchestrator' && args.task.task_type === 'register_watch_conditions') {
      const registered = await runRegisterWatchConditions();
      return { action_taken, result: { registered }, outcome_score: undefined };
    }

    if (args.task.agent_role === 'orchestrator' && args.task.task_type === 'review_bot_states') {
      const actions = await reviewAndTransitionBots();
      const escalations = await checkForCircuitBreakerEscalations();
      return { action_taken, result: { actions, escalations }, outcome_score: undefined };
    }

    if (args.task.agent_role === 'orchestrator' && args.task.task_type === 'generate_priority_map') {
      const { data: botStates, error: bsErr } = await supabaseAdmin.from('bot_states').select('*');
      if (bsErr) throw bsErr;

      // Placeholder IS per bot: use latest IS overall for now.
      const { data: isRow } = await supabaseAdmin
        .from('intelligence_scores')
        .select('value')
        .eq('metric', 'intelligence_score')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestIs = isRow ? Number((isRow as any).value ?? 0) : 0;
      const isScores: Record<string, number> = {};
      for (const b of botStates ?? []) isScores[String((b as any).bot_id)] = latestIs;

      const priorities = computeDeskPriorities((botStates ?? []) as any, isScores);
      return { action_taken, result: priorities as any, outcome_score: undefined };
    }

    // Strategy computations
    if (a.type === 'formalize_strategy') {
      const formalization = formalizeStrategy(tInput.finding);
      const expected = tInput.expected_answer;
      const outcome_score = expected ? grade(expected, formalization) : undefined;
      return { action_taken: { ...action_taken, formalization }, result: formalization, outcome_score };
    }

    if (a.type === 'challenge_strategy') {
      // Deterministic adversarial pass (test-mode friendly). In non-test environments this can be upgraded.
      const findingId = String(tInput.finding_id ?? tInput.formalization?.finding_id ?? '');
      let formalization: any = tInput.formalization ?? null;

      if (!formalization && findingId) {
        const { data: eps } = await supabaseAdmin
          .from('episodes')
          .select('action_taken,task_input,created_at')
          .in('task_type', ['formalize_strategy', 'formalize_crypto_strategy'])
          .order('created_at', { ascending: false })
          .limit(50);

        const ep = (eps ?? []).find((e: any) => {
          const fid = e?.action_taken?.formalization?.finding_id ?? e?.task_input?.finding?.id;
          return String(fid) === findingId;
        });
        formalization = ep?.action_taken?.formalization ?? null;
      }

      // Use a real LLM adversarial challenge review (replaces deterministic stub).
      const skillContent = await this.loadRoleSkill('strategy');

      const challengePrompt = `You are the Strategy Bot performing an adversarial challenge review.

STRATEGY FORMALIZATION:
${JSON.stringify(formalization, null, 2)}

Your task: challenge_strategy

Apply the REASONING STRUCTURE from your SKILL exactly:
1. Identify the single load-bearing assumption — what one assumption, if wrong, kills this strategy's expectancy entirely?
2. Name the specific regime where that assumption fails (be precise — not just "high vol")
3. Estimate failure probability (0.0–1.0) — probability this strategy underperforms its backtest by >30% in the first 30 trades
4. Verdict: proceed | revise | abandon

Respond with ONLY valid JSON, no other text:
{
  "weakest_assumption": "string",
  "failure_regime": "string",
  "failure_probability": number,
  "verdict": "proceed" | "revise" | "abandon",
  "notes": "string"
}`;

      let report: {
        weakest_assumption: string;
        failure_regime: string;
        failure_probability: number;
        verdict: 'proceed' | 'revise' | 'abandon';
        notes: string;
      };

      try {
        const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic');
        const raw = await claudeText({
          system: skillContent,
          user: challengePrompt,
          maxTokens: 800,
          temperature: 0.2,
        });

        const parsed = extractFirstJsonObject(raw);
        const verdictRaw = String((parsed as any)?.verdict ?? 'revise');

        report = {
          weakest_assumption: String((parsed as any)?.weakest_assumption ?? ''),
          failure_regime: String((parsed as any)?.failure_regime ?? ''),
          failure_probability: Math.min(1, Math.max(0, Number((parsed as any)?.failure_probability ?? 0.5))),
          verdict: (['proceed', 'revise', 'abandon'] as const).includes(verdictRaw as any) ? (verdictRaw as any) : 'revise',
          notes: String((parsed as any)?.notes ?? ''),
        };
      } catch (e: any) {
        console.warn('[CHALLENGE] Failed to parse LLM response, defaulting to revise:', e?.message ?? e);
        report = {
          weakest_assumption: 'Could not extract from LLM response',
          failure_regime: 'unknown',
          failure_probability: 0.5,
          verdict: 'revise',
          notes: 'Challenge parsing failed — strategy flagged for manual review.',
        };
      }

      console.log('[CHALLENGE] report:', report);

      // FIX 3: revision cycle limit + persist challenge notes.
      if (findingId) {
        const { data: finding } = await supabaseAdmin.from('research_findings').select('revision_count,max_revision_cycles').eq('id', findingId).maybeSingle();
        const currentCount = Number((finding as any)?.revision_count ?? 0);
        const maxCycles = Number((finding as any)?.max_revision_cycles ?? 2);

        if (report.verdict === 'revise') {
          if (currentCount >= maxCycles) {
            report.verdict = 'abandon';
            report.notes += ` [AUTO-ARCHIVED: max revision cycles (${maxCycles}) reached]`;
            await supabaseAdmin
              .from('research_findings')
              .update({ status: 'archived', challenge_notes: `Auto-archived after ${maxCycles} revision cycles without passing challenge.` })
              .eq('id', findingId);
          } else {
            await supabaseAdmin
              .from('research_findings')
              .update({
                revision_count: currentCount + 1,
                challenge_notes: `${report.weakest_assumption}: ${report.failure_regime}`,
                status: 'needs_revision',
              })
              .eq('id', findingId);
          }
        }

        if (report.verdict === 'proceed') {
          await supabaseAdmin
            .from('research_findings')
            .update({ status: 'challenged', challenge_notes: `${report.weakest_assumption}: ${report.failure_regime}` })
            .eq('id', findingId);
        }
      }

      if (report.verdict === 'proceed' && formalization) {
        const isCrypto = String(args.task.desk ?? '') === 'crypto_markets';

        const outcomes: number[] = [];

        const { error } = await supabaseAdmin.from('tasks').insert({
          task_type: isCrypto ? 'run_crypto_backtest' : 'run_backtest',
          task_input: {
            formalization,
            outcomes,
            slippage: isCrypto ? 0.001 : 0.0015,
          },
          status: 'queued',
          tags: ['strategy', isCrypto ? 'crypto' : 'prediction_markets'],
          agent_role: 'strategy',
          desk: isCrypto ? 'crypto_markets' : 'prediction_markets',
          bot_id: isCrypto ? 'crypto-strategy-bot-1' : 'strategy-bot-1',
        });
        if (error) throw error;

        console.log(`[CHALLENGE] Strategy ${findingId} passed — seeding backtest`);
        return { action_taken: { ...action_taken, challenge: report }, result: report, outcome_score: 0.7 };
      }

      if (report.verdict === 'abandon' && findingId) {
        await updateFindingStatus(findingId, 'archived');
        console.log(`[CHALLENGE] Strategy ${findingId} abandoned pre-backtest — failure_probability=${report.failure_probability}`);
        return { action_taken: { ...action_taken, challenge: report }, result: report, outcome_score: 0.8 };
      }

      if (report.verdict === 'revise' && findingId) {
        await updateFindingStatus(findingId, 'under_investigation');
        console.log(`[CHALLENGE] Strategy ${findingId} needs revision — returned to Research`);
        return { action_taken: { ...action_taken, challenge: report }, result: report, outcome_score: 0.5 };
      }

      return { action_taken: { ...action_taken, challenge: report }, result: report, outcome_score: 0.5 };
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
    const outcome_score = expected ? grade(expected, actual) : (args.actOut.outcome_score ?? 0);
    const outcome: EpisodeOutcome = expected ? (outcome_score === 1 ? 'correct' : 'incorrect') : (outcome_score > 0 ? 'partial' : 'incorrect');

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

Additionally, when OUTCOME is incorrect, classify this failure with exactly one error_type value:
- computation_error: the formula or calculation was wrong
- strategy_error: the approach or plan was wrong for this task
- data_quality: the input data was malformed or missing
- regime_mismatch: the approach was valid but wrong for current market conditions
- unknown: cannot determine cause

Return error_type as a field in your JSON response when OUTCOME is incorrect.
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
        error_type: correct ? undefined : 'unknown',
      };
    }

    const hasKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0;
    if (!hasKey) {
      const correct = args.obsOut.outcome === 'correct';
      return {
        reflection_text: correct
          ? 'No ANTHROPIC_API_KEY; skipping LLM reflection. Outcome was correct.'
          : 'No ANTHROPIC_API_KEY; skipping LLM reflection. Outcome was incorrect; review manually.',
        reasoning_score: correct ? 0.5 : 0.3,
        lessons: correct ? [] : ['No LLM reflection available in this environment.'],
        error_type: correct ? undefined : 'unknown',
      };
    }

    const { claudeText, extractFirstJsonObject } = await import('../lib/anthropic.js');
    const raw = await claudeText({ system, user, maxTokens: 600, temperature: 0.2 });
    const parsed = extractFirstJsonObject(raw);

    const error_type = String(parsed.error_type ?? 'unknown');
    const allowed = new Set(['computation_error', 'strategy_error', 'data_quality', 'regime_mismatch', 'unknown']);

    return {
      reflection_text: String(parsed.reflection_text ?? ''),
      reasoning_score: Number(parsed.reasoning_score ?? 0.5),
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.map(String) : [],
      error_type: args.obsOut.outcome === 'incorrect' && allowed.has(error_type) ? (error_type as any) : undefined,
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

    // Update within-session recent failures buffer after the episode is written.
    if (args.episode.outcome === 'incorrect') {
      this.recentFailures.unshift(args.episode);
      this.lastFailureAtMs = Date.now();
      if (this.recentFailures.length > 5) this.recentFailures.pop();
    }

    return {
      episode_id: written.id,
      episode_written: true,
      semantic_updates: 0,
      procedure_updates: 0,
    };
  }
}

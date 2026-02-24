// THE BRAIN — Typescript contracts (Phase 1 scaffold)

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type EpisodeOutcome = 'correct' | 'incorrect' | 'partial';
export type MemoryStatus = 'active' | 'flagged' | 'retired';

export type BotBehavioralState =
  | 'exploiting'
  | 'cautious'
  | 'paused'
  | 'diagnostic'
  | 'recovering';

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
  error_type?:
    | 'computation_error'
    | 'strategy_error'
    | 'data_quality'
    | 'regime_mismatch'
    | 'unknown'
    | null;

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

export interface BotState {
  bot_id: string;
  agent_role: string;
  desk: string;
  current_state: BotBehavioralState;
  state_since: string;
  reason: string | null;
  requires_manual_review: boolean;
  warm_up: boolean;
  warm_up_episodes_remaining: number;
  is_at_entry: number | null;
  consecutive_wins: number;
  consecutive_losses: number;
  trades_in_state: number;
  good_is_windows: number;
  peak_outcome_score: number | null;
  current_drawdown: number | null;
  drawdown_velocity: number | null;
  profit_factor: number | null;
  diagnostic_attempts: number;
  diagnostic_max: number;
  last_root_cause: string | null;
  updated_at: string;
}

export interface StateTransition {
  id: string;
  created_at: string;
  bot_id: string;
  from_state: BotBehavioralState;
  to_state: BotBehavioralState;
  reason: string | null;
  metric_snapshot: Record<string, any> | null;
}

export interface StateCheckResult {
  shouldAbort: boolean;
  reason: string;
  state: BotBehavioralState;
}

// ── Trading Desk Interfaces ──────────────────

// ── Research Bot ─────────────────────────────────────────────────
export type EdgeType =
  | 'behavioral'
  | 'structural_flow'
  | 'liquidity'
  | 'microstructure'
  | 'correlated_arbitrage'
  | 'late_resolution'
  | 'information_asymmetry';

export type FindingType = 'live_edge' | 'dead_end' | 'preliminary' | 'under_investigation';

export type FindingStatus =
  | 'under_investigation'
  | 'passed_to_backtest'
  | 'in_backtest'
  | 'archived'
  | 'deployed';

export type FindingRecommendation = 'pass_to_backtest' | 'investigate_further' | 'archive';

export interface RQSComponents {
  statistical_rigor: number; // 0-1
  mechanism_clarity: number; // 0-1
  novelty: number; // 0-1
  cost_adjusted_edge: number; // 0-1
}

export interface ResearchFinding {
  id: string;
  created_at: string;
  bot_id: string;
  desk: string;
  agent_role: string;
  finding_type: FindingType;
  edge_type: EdgeType;
  description: string;
  mechanism: string | null;
  failure_conditions: string | null;
  market: string | null;
  regime_notes: string | null;
  rqs_score: number | null;
  rqs_components: RQSComponents | null;
  sample_size: number | null;
  observed_rate: number | null;
  base_rate: number | null;
  lift: number | null;
  out_of_sample: boolean;
  status: FindingStatus;
  recommendation: FindingRecommendation | null;
  backtest_result: string | null;
  supporting_episode_ids: string[];
  notes: string | null;
}

// ── Strategy Bot ─────────────────────────────────────────────────
export interface BacktestReport {
  strategy_id: string;
  finding_id: string;
  in_sample_sharpe: number;
  out_sample_sharpe: number;
  in_sample_trades: number;
  out_sample_trades: number;
  max_drawdown: number;
  recovery_periods: number | null;
  profit_factor: number;
  regime_results: Record<string, number>;
  overfitting_flags: string[];
  slippage_assumed: number;
  recommendation: 'approved_for_forward_test' | 'return_to_research' | 'archived';
  reason: string;
}

// Implied by spec (not listed in Section 03): formal strategy rules derived from a finding.
export interface StrategyFormalization {
  finding_id: string;
  entry_conditions: string;
  exit_conditions: string;
  position_sizing_rule: string;
  invalidation_criteria: string;
  market_scope: string;
  created_at: string;
  created_by: string; // bot_id
}

// ── Risk Bot ─────────────────────────────────────────────────────
export interface RiskSnapshot {
  timestamp: string;
  open_positions: number;
  unrealized_pnl: number;
  drawdown_from_peak: number;
  drawdown_velocity: number;
  kelly_multiplier: number;
  enp: number;
  active_breakers: string[];
  warnings: string[];

  // Crypto-specific (optional)
  vol_regime?: 'low' | 'normal' | 'elevated' | 'extreme' | null;
  btc_dominance?: number | null;
}

export interface CircuitBreakerEvent {
  breaker_type: string;
  triggered_at: string;
  trigger_value: number;
  threshold: number;
  action_taken: string;
}

// ── Execution Bot ─────────────────────────────────────────────────
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderStatus = 'pending' | 'filled' | 'partial' | 'rejected' | 'cancelled';

export interface OrderRecord {
  order_id: string;
  bot_id: string;
  market_ticker: string;
  market_type: 'prediction' | 'crypto' | 'equity' | 'options';
  order_type: OrderType;
  side: 'yes' | 'no' | 'buy' | 'sell';
  size: number;
  limit_price: number | null;
  fill_price: number | null;
  fill_size: number;
  status: OrderStatus;
  slippage: number | null;
  attempt_count: number;
  created_at: string;
  filled_at: string | null;

  // Options only
  option_type?: 'call' | 'put' | null;
  strike?: number | null;
  expiry?: string | null;
}

// ── Intelligence Bot ─────────────────────────────────────────────
export interface ConsolidationReport {
  date: string;
  episodes_read: number;
  facts_extracted: number;
  facts_updated: number;
  facts_retired: number;
  episodes_pruned: number;
  cross_desk_learnings: number;
  bots_evaluated: string[];
}

export type PositionStatus = 'open' | 'closed' | 'partially_closed';

export type ExitReason = 'profit_target' | 'stop_loss' | 'time_exit' | 'circuit_breaker' | 'manual';

export interface Position {
  id: string;
  created_at: string;
  updated_at: string;

  bot_id: string;
  desk: string;
  market_type: 'prediction' | 'crypto' | 'equity' | 'options';
  strategy_id: string | null;

  market_ticker: string;

  status: PositionStatus;
  side: 'yes' | 'no';

  entry_price: number;
  current_price: number | null;

  size: number;
  remaining_size: number;

  unrealized_pnl: number;
  realized_pnl: number;

  peak_price: number | null;

  stop_level: number;
  profit_target: number;
  slippage_assumed: number;

  closed_at: string | null;
  exit_price: number | null;
  exit_reason: ExitReason | null;

  entry_episode_id: string | null;
  exit_episode_id: string | null;
}

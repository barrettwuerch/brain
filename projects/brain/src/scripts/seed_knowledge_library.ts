import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';

type KnowledgeChunk = {
  chunk_id: string;
  desk: 'shared' | 'prediction' | 'crypto';
  applies_to: 'all' | string[];
  title: string;
  content: string;
};

function normalizeAppliesTo(applies_to: KnowledgeChunk['applies_to']): string[] {
  if (applies_to === 'all') return ['all'];
  return applies_to;
}

function metaSource(c: KnowledgeChunk): string {
  return JSON.stringify({
    block: 4,
    chunk_id: c.chunk_id,
    desk: c.desk,
    applies_to: normalizeAppliesTo(c.applies_to),
  });
}

async function exists(domain: string, title: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('knowledge_library')
    .select('id')
    .eq('domain', domain)
    .eq('title', title)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function insertChunk(c: KnowledgeChunk): Promise<'inserted' | 'skipped'> {
  // Idempotency: (domain, title) de-dupe.
  const domain = c.desk;
  if (await exists(domain, c.title)) return 'skipped';

  const { error } = await supabaseAdmin.from('knowledge_library').insert({
    title: c.title,
    source: metaSource(c),
    domain,
    agent_role: null,
    content: c.content,
  });
  if (error) throw error;
  return 'inserted';
}

// NOTE: applies_to task strings must match actual task_type strings used in code.
// Mapping: rqs_score_finding -> score_rqs
const CHUNKS: KnowledgeChunk[] = [
  // ── Shared fundamentals (S-series) ───────────────────────────────────────
  {
    chunk_id: 'S-01',
    desk: 'shared',
    applies_to: 'all',
    title: 'Bayesian Updating in Trading Contexts',
    content: `Every reasoning call is a Bayesian update. You have a prior (your semantic memory and knowledge library), you receive evidence (the current task input), and you produce a posterior (your recommendation). Most reasoning errors come from two failure modes: anchoring too heavily on the current evidence and underweighting well-established priors, or anchoring too heavily on stale priors and underweighting strong new evidence. The practical rule: a single episode should not dramatically shift a semantic fact that is supported by 10+ prior episodes. Require multiple independent confirming observations before elevating a new pattern to high confidence. Conversely, a single strong contradicting observation of a well-established fact deserves a confidence reduction, not dismissal. Strong prior + weak contradicting evidence = slight confidence reduction, continue. Weak prior + strong confirming evidence = significant confidence increase. Strong prior + strong contradicting evidence = flag for investigation, do not auto-resolve. Decision heuristic: Before acting on any single observation, ask: how many independent confirming observations does my prior rest on? Weight the current evidence inversely to that count.`,
  },
  {
    chunk_id: 'S-02',
    desk: 'shared',
    applies_to: 'all',
    title: 'Hierarchy of Evidence in Quantitative Research',
    content: `Not all evidence is equal. When evaluating any finding or recommendation, identify where in this hierarchy the supporting evidence sits: 1. Prospective out-of-sample results (strongest — you didn't look at this data when building) 2. Walk-forward validation results (strong — systematic out-of-sample across windows) 3. Time-series cross-validation (moderate — some look-ahead risk depending on implementation) 4. Simple train/test split (moderate — vulnerable to regime mismatch between periods) 5. In-sample backtest results (weak — always overstates edge) 6. Qualitative mechanism argument only (weakest — untested hypothesis) A finding supported only by in-sample results and a plausible mechanism story is not ready for forward testing. A finding with strong walk-forward results in multiple regimes is ready regardless of how compelling the mechanism sounds. Decision heuristic: Before scoring any finding above RQS 0.70, confirm the supporting evidence is at level 3 or above. Level 5-6 evidence caps the RQS at 0.65 regardless of mechanism quality.`,
  },
  {
    chunk_id: 'S-03',
    desk: 'shared',
    applies_to: 'all',
    title: 'Second-Order Thinking for Market Edges',
    content: `Every claimed edge must pass a second-order test before it earns high mechanism clarity. First-order: this pattern predicts price movement. Second-order: if this pattern is genuinely predictive, why haven't other participants already traded it away? Possible answers: (a) the market is thin and sophisticated capital hasn't bothered, (b) the edge requires non-obvious data combination, (c) the edge is real but small enough that transaction costs deter most players, (d) you're wrong about the edge. Third-order: if other participants are aware of it, what does their behavior look like in the data? Are you seeing the footprint of sophisticated makers or algorithms already positioned against this pattern? Markets that are actively arbitraged leave specific signatures: the edge decays over the sample period, the edge is larger in less-liquid hours, the edge disappears when transaction costs are modeled accurately. Decision heuristic: If you cannot articulate a convincing answer to "why hasn't this been arbitraged away," assign mechanism_clarity no higher than 0.50 until you can.`,
  },
  {
    chunk_id: 'S-04',
    desk: 'shared',
    applies_to: ['score_rqs', 'challenge_strategy', 'run_backtest', 'run_crypto_backtest'],
    title: 'The Multiple Comparisons Problem',
    content: `The most common source of false discoveries in quantitative research is testing many hypotheses and reporting only the ones that showed significance. If you test 50 indicators and find 3 that show p < 0.05 significance, the true expected number of false positives is 50 × 0.05 = 2.5. You may have found one real signal and two noise patterns that got lucky. The practical correction: count how many hypothesis tests were implicitly conducted to produce this finding. Every scan that didn't find anything still counts. The minimum Sharpe ratio required for statistical significance roughly doubles for every 10-fold increase in the number of strategies tested. For the Research Bot's scanning workflow specifically: every scan that runs without producing a finding is an implicit hypothesis test. If the Research Bot runs 40 scans before finding one with RQS ≥ 0.65, that finding requires much stronger out-of-sample confirmation before it should be trusted. Decision heuristic: Ask how many scans produced nothing before this finding emerged. If the ratio of rejected scans to approved findings exceeds 20:1, require walk-forward validation before approving for forward test.`,
  },
  {
    chunk_id: 'S-05',
    desk: 'shared',
    applies_to: ['size_position', 'monitor_positions'],
    title: 'Kelly Criterion — Summary',
    content: `Kelly criterion maximizes long-run geometric growth rate of wealth. The system uses fractional Kelly (0.25x) because full Kelly assumes perfect knowledge of edge and odds. Estimation error at full Kelly produces dramatically worse outcomes than fractional Kelly. The 0.25x fraction accepts lower expected return in exchange for far lower variance and robustness to estimation error. Correlation adjustment is mandatory: Kelly is derived for independent bets. Failing to adjust for correlation is the most common Kelly implementation error. The drawdown scaling table reflects updated beliefs, not just caution. Drawdown is evidence that edge estimates were too high. See chunk B-06 for the complete Kelly framework including derivation, ruin probabilities, and the full correlation adjustment formula. When both chunks are in context, B-06 takes precedence. Decision heuristic: Before finalizing any position size, check portfolio correlation. If new position correlates > 0.5 with existing book, halve the base Kelly fraction before applying the drawdown table.`,
  },
  {
    chunk_id: 'S-06',
    desk: 'shared',
    applies_to: ['consolidate_memories', 'attribute_performance'],
    title: 'Skill vs Luck in Performance Attribution',
    content: `The calibration score (Spearman correlation between reasoning scores and outcome scores) is the best measure of genuine skill because it cannot be gamed by luck. A bot that gets lucky will have high outcome scores but low calibration — it was confident on bad reasoning that happened to work. High calibration with moderate outcomes is a better signal of genuine skill than high outcomes with low calibration. IS scores computed on fewer than 50 episodes have high variance and should be treated as directional signals, not precise measurements. A bot at IS = 0.12 based on 15 episodes is not meaningfully different from one at IS = 0.08. The Fundamental Law of Active Management (Grinold): Information Ratio = IC × √Breadth, where IC is the information coefficient (skill per decision) and Breadth is the number of independent decisions per period. A bot making many small correct decisions is more valuable than one making few large correct ones, even if point-in-time performance looks similar. Decision heuristic: When evaluating whether a bot's IS score reflects genuine skill, check calibration first. IS above threshold with calibration below 0.3 = lucky, not skilled. Hold off on state transitions until calibration confirms.`,
  },
  {
    chunk_id: 'S-07',
    desk: 'shared',
    applies_to: ['consolidate_memories'],
    title: 'Cross-Desk Learning Validity',
    content: `The provisional cross-desk fact system (import at 60% confidence, promote after 3 confirmations) exists because some patterns are genuinely cross-desk and some are not. The Intelligence Bot must apply an explicit test before distributing any fact across desks. The cross-desk validity test: 1. Mechanism test: Does the mechanism operate through a common underlying driver that affects both desks? "Macro risk-off events suppress trader confidence" is valid — macro events affect both Kalshi sentiment and crypto positioning. "Late-stage probability compression suppresses volume anomaly reliability" is NOT cross-desk — it is specific to binary contract resolution mechanics. 2. Structural equivalence test: Kalshi contracts have discrete resolution events. Crypto does not. Patterns that depend on resolution timing are never cross-desk. 3. Confirmation requirement: Even if the mechanism passes both tests, require 3 independent confirming observations on the receiving desk before promoting from provisional to established. One-way validity: crypto regime patterns may inform Kalshi desk risk posture (regime is shared), but Kalshi microstructure patterns almost never apply to crypto. Asymmetric generalization default: crypto-originated facts have higher cross-desk generalization probability than Kalshi-originated facts. Decision heuristic: Before distributing any fact cross-desk, answer: does the mechanism work through a driver that affects both markets structurally, or is it specific to one desk's resolution/pricing mechanics? If the latter, mark as desk-specific and do not distribute.`,
  },
  {
    chunk_id: 'S-08',
    desk: 'shared',
    applies_to: ['consolidate_memories', 'generate_daily_report'],
    title: 'Intelligence Bot Failure Modes',
    content: `The Intelligence Bot has two systematic failure modes that distort its outputs in ways that are hard to detect without explicit checks. Confirmation bias in fact extraction: The bot is more likely to extract new facts consistent with existing semantic beliefs than facts that contradict them. The test: for every candidate fact that confirms an existing belief, explicitly search for contradicting evidence in the same episode batch. If you find none, it does not mean none exists — it may mean you stopped looking. Availability bias in reporting: Recent events are reported more prominently than their signal significance warrants. A one-day vol spike that occurred yesterday receives more emphasis than a persistent 14-day drift. The test: before writing the NEEDS ATTENTION section, rank all candidate items by signal significance (how much does this change what we should do?), not by recency. Report in signal order, not time order. Decision heuristic: Before finalizing consolidate_memories output, ask: am I extracting this fact because it's genuinely new information, or because it confirms something I already believe? Before finalizing generate_daily_report, ask: is this item in NEEDS ATTENTION because it requires action, or because it happened recently?`,
  },

  // ── Prediction desk (P-series) ────────────────────────────────────────────
  {
    chunk_id: 'P-01',
    desk: 'prediction',
    applies_to: ['market_trend_scan', 'score_rqs'],
    title: 'Kalshi Market Structure and Contract Mechanics',
    content: `Kalshi is a CFTC-regulated designated contract market. Contracts are binary: each pays $1 if Yes resolves true, $0 if No. Prices range from $0.01 to $0.99 and reflect implied probability. The exchange uses a single-contract model internally — there is no independent Yes contract and No contract. A Yes bid at price X is equivalent to a No ask at (1-X). Order types: limit orders (resting, may qualify for maker fee discount) and market orders (immediate fill, always pay taker fee). Closing a position requires opening an offsetting order. Total round-trip cost always equals approximately $1 per contract pair plus fees. Fee formula: 0.07 × contracts × price × (1 - price). Maximum fee at 50/50 contracts (~$35 per $1,000 position at even odds), approaching zero at extreme probabilities. A $0.05 contract costs ~$0.003 in fees but wins only ~4% of the time. Liquidity reality: even top-decile Kalshi markets average only ~$526k total volume at close. Order books are thin. A $10k position in a mid-tier market meaningfully moves the price. Decision heuristic: Before flagging any Kalshi trend signal, check open interest and 24h volume. If total volume < $50k, the market is illiquid and trend signals are unreliable — execution cost will exceed edge.`,
  },
  {
    chunk_id: 'P-02',
    desk: 'prediction',
    applies_to: ['market_trend_scan', 'score_rqs'],
    title: 'Favorite-Longshot Bias on Kalshi',
    content: `Empirically documented across 300,000+ Kalshi contracts: contracts below $0.20 systematically win less often than their price implies. Contracts above $0.80 win more often than their price implies. Confirmed in peer-reviewed research (Whelan et al. 2025, Becker 2025). The bias is not subtle: contracts at $0.05 win only ~4.18% of the time (mispricing of -16%). Contracts at $0.95 win ~95.83% of the time. The market correctly prices the middle range. Post-2024, sophisticated algorithmic makers have entered and are already exploiting this — the edge is smaller and harder to capture than 2021-2023. A contract priced at $0.12 that your model assigns 18% probability is a genuine edge. A contract priced at $0.08 that your model assigns 10% may look like edge but fee structure and longshot bias likely erode it entirely. Decision heuristic: For any finding involving contracts priced below $0.15 or above $0.85, model the fee impact explicitly using 0.07 × price × (1-price) before assigning RQS. Longshot plays require larger probability edge to clear the fee bar.`,
  },
  {
    chunk_id: 'P-03',
    desk: 'prediction',
    applies_to: ['market_trend_scan', 'volume_anomaly_detect'],
    title: 'Probability Compression Near Resolution',
    content: `Binary contracts mechanically converge toward 0 or 1 as resolution approaches — mathematical certainty, not a market signal. A contract moving from $0.45 to $0.65 in 48 hours has two possible explanations: genuine information flow, or probability compression as the market incorporates known upcoming events. Test: does the price move precede or coincide with a scheduled information event? Price movement 72+ hours before an information event more likely reflects genuine private information flow. Within 24-48 hours of a scheduled event, more likely resolution compression. Late-stage momentum signals (within 72 hours of resolution) are almost always compression artifacts, not tradeable edge. Exception: contracts where new information genuinely arrives close to resolution — distinguishable by volume spikes that precede price moves. Decision heuristic: For any trend signal within 72 hours of resolution, require a volume spike that precedes the price move by at least 2 hours. Price-leads-volume near resolution = compression. Volume-leads-price = information.`,
  },
  {
    chunk_id: 'P-04',
    desk: 'prediction',
    applies_to: ['volume_anomaly_detect'],
    title: 'Volume Normalization for Kalshi Markets',
    content: `Kalshi volume is structurally higher in the 72 hours before resolution. A volume spike appearing 3x the 30-day rolling average may be only 1.2x when adjusted for typical pre-resolution elevation. Always normalize against resolution-proximity-adjusted baselines. Accumulation pattern: volume spike + price stable or moving slightly in one direction. Suggests informed participants entering before information is fully priced. More reliable signal. Reaction pattern: volume spike + sharp simultaneous price move. Suggests the market is reacting to publicly available information. Less actionable — you are seeing the effect, not the cause. For crypto-linked Kalshi contracts (BTC price levels, Nasdaq endpoints): volume resets hourly and behaves differently from event-based contracts. Do not apply the same baseline normalization. Decision heuristic: Volume anomaly + price unchanged → accumulation signal, investigate further. Volume anomaly + price already moved → reaction signal, RQS cap at 0.60.`,
  },
  {
    chunk_id: 'P-05',
    desk: 'prediction',
    applies_to: ['validate_edge_mechanism'],
    title: 'Three Canonical Mechanism Failure Modes — Prediction Markets',
    content: `When validating any proposed mechanism on the prediction desk, check all three failure modes explicitly: Arbitrage decay: Does the edge depend on a structural inefficiency that attracts capital? Mechanisms that depend on institutional blind spots in large markets typically decay within months of documentation. Is this mechanism documented in public research? If yes, assume partial arbitrage has occurred. Regime specificity: Many mechanisms are real but only in specific regimes. In which of the three backtested regime windows did this mechanism actually drive performance? A mechanism that only works in normal vol regime requires regime-conditional deployment. Factor exposure: Many seemingly novel mechanisms are latent exposures to known factors (momentum, carry, mean-reversion). Does the mechanism predict outcomes independently of what a simple momentum or mean-reversion signal would predict? If not, it's a factor exposure, not an independent edge. Decision heuristic: A mechanism fails validation if: (1) documented in public research without a compelling reason it hasn't been arbitraged, (2) worked in only one of three regime windows, or (3) fully explained by a simpler known factor. Any one caps mechanism_clarity at 0.50.`,
  },
  {
    chunk_id: 'P-06',
    desk: 'prediction',
    applies_to: ['challenge_strategy', 'run_backtest'],
    title: 'Kalshi-Specific Backtest Integrity Checks',
    content: `Kalshi backtests have three failure modes that continuous-market backtests don't: Fee drag underestimation: 0.07 × price × (1 - price) must be applied to both entry and exit. Round-trip fee on a $0.50 contract = $0.07. Many backtests apply fees only to entry or use a flat approximation. Execution cost at thin liquidity: Model execution as entry at ask + 0.5 spread, exit at bid - 0.5 spread. If this reduces expectancy below breakeven, the edge is only real at mid-price, not executable. Resolution timing edge: Contracts heading toward 0 or 1 late in lifecycle often have stale order books. Any backtest profit generated within 6 hours of resolution on contracts above $0.90 or below $0.10 should be treated as suspect. Decision heuristic: Run P&L decomposition: what fraction of returns came from contracts within 72 hours of resolution? From contracts at extreme prices (>$0.85 or <$0.15)? If either exceeds 40% of total returns, the strategy may be capturing structural artifacts.`,
  },
  {
    chunk_id: 'P-07',
    desk: 'prediction',
    applies_to: ['formalize_strategy', 'challenge_strategy'],
    title: 'Maker vs Taker Strategy Implications on Kalshi',
    content: `Makers post resting orders, wait for fills. Best for strategies where you have a price target and can wait. Risk: adverse selection from sophisticated algorithmic takers. Takers cross the spread for immediate fill. Best for time-sensitive signals. Risk: spread cost on thin markets can be 3-5 cents on mid-tier markets, a ~6-10% cost relative to expected profit on a $0.50 contract. Sophisticated makers systematically outperform takers on average (Becker 2025, Whelan et al.). A well-calibrated taker with genuine information advantage can still be profitable — the fee drag is the hurdle, not an absolute barrier. Decision heuristic: Any strategy depending on taker execution must show expected return per trade of at least 3x the modeled spread + fee cost. If 2x or less, the strategy is only viable as a maker strategy with limit order entry.`,
  },

  // ── Crypto desk (C-series) ────────────────────────────────────────────────
  {
    chunk_id: 'C-01',
    desk: 'crypto',
    applies_to: ['crypto_trend_scan', 'publish_regime_state'],
    title: 'Crypto Volatility Regime Classification',
    content: `Volatility regime classification in crypto requires multi-window realized vol. Use three windows simultaneously: 1-day realized (responsive but noisy), 5-day realized (stable trend indicator), ratio of 1-day/5-day (transition detector). When the 1-day/5-day ratio exceeds 1.5, the market is in a vol transition. Add a TRANSITIONING flag rather than forcing a binary classification. BTC dominance dynamic: when BTC vol spikes, BTC-ETH correlations converge toward 1.0 rapidly. Classify the desk regime as the maximum of BTC and ETH regime states, never an average. This is asymmetric by design. Regime transitions are the highest-risk periods. All strategies were sized and validated under the old regime. Treat transitions as a separate state requiring conservative position sizing. Decision heuristic: If 1-day/5-day vol ratio > 1.5, set regime to TRANSITIONING and apply the next-higher regime's position size limits immediately.`,
  },
  {
    chunk_id: 'C-02',
    desk: 'crypto',
    applies_to: ['funding_rate_scan', 'crypto_volume_profile', 'volume_anomaly_detect'],
    title: 'Funding Rate Mechanics and Signal Interpretation',
    content: `Positive funding = longs pay shorts (perpetual trading at premium). Negative funding = shorts pay longs (perpetual at discount). Funding rates reset every 8 hours (00:00, 08:00, 16:00 UTC on most exchanges). Timing matters: a spike 2+ hours before a reset is more likely genuine directional conviction. A spike in the hour before a reset is more likely position adjustment. Normal vol regime: volume leads funding rate (volume spike → funding rate move 2-4 hours later). Stressed regime (liquidation cascade): volume and funding rate move simultaneously — this is an effect of liquidations, not a cause of future price movement. Decision heuristic: Funding rate signal is only actionable when it diverges from mean by >2 standard deviations AND the divergence precedes the volume spike by at least 30 minutes. Simultaneous funding/volume spikes = cascade in progress, do not enter.`,
  },
  {
    chunk_id: 'C-03',
    desk: 'crypto',
    applies_to: ['crypto_volume_profile', 'crypto_trend_scan', 'volume_anomaly_detect'],
    title: 'Liquidation Cascade Signatures',
    content: `Pre-cascade signatures: funding rate elevated >3 SD above mean while open interest is also elevated; volume increasing while price advances more slowly than historical vol would predict; bid/ask spread widening without corresponding increase in volatility. During cascade: volume explodes, price moves 5-10% in minutes, funding rate spikes or collapses. This is the circuit breaker zone — do not enter new positions. Post-cascade (potential mean-reversion): price has overshot due to forced liquidations, volume declining from peak, funding rate normalizing. Potential entry zone IF regime has stabilized. A 10% BTC drop in 60 minutes typically exhausts its acute phase within 15-20 minutes. Monitor for stabilization rather than remaining paused indefinitely. Decision heuristic: If volume spike exceeds 5x 30-day average AND funding rate is simultaneously elevated >3 SD from mean, classify as cascade-risk. Post-cascade entry window: volume returning to 2x or below AND funding rate within 1 SD of mean for 30+ minutes.`,
  },
  {
    chunk_id: 'C-04',
    desk: 'crypto',
    applies_to: ['publish_regime_state', 'monitor_positions'],
    title: 'Crypto Vol Regime Persistence',
    content: `Crypto volatility regimes exhibit strong persistence. Low vol: most dangerous time to be under-positioned, the market is building pressure. Normal vol: optimal for most strategies. Elevated vol: momentum strategies that worked in normal vol often flip sign. Extreme vol: BTC correlation with equities rises sharply, cross-desk correlated exposure becomes dangerous — 50% of normal position limits. If the same regime has persisted for >14 days, apply an additional 20% haircut to position sizes for regime-dependent strategies. Long regime tenure = crowded positioning = worse execution when everyone exits simultaneously. Decision heuristic: If regime has been in the same state for >14 days, flag as potentially crowded and reduce regime-dependent strategy sizes by 20% regardless of drawdown state.`,
  },
  {
    chunk_id: 'C-05',
    desk: 'crypto',
    applies_to: ['run_crypto_backtest', 'challenge_crypto_strategy', 'detect_overfitting'],
    title: 'Crypto Backtest Integrity',
    content: `Regime-split requirement: crypto markets have experienced at least 4 distinct structural regimes since 2020 (COVID crash, 2021 bull, 2022 bear, 2023-2024 recovery). Require positive expectancy in at least 3 of 4 before approving. Funding rate data timing: funding rate impact on price happens continuously as positions adjust to avoid paying the rate. Use funding rate as a continuous influence, not a discrete 8-hour event. Spread modeling by regime: 0.1% round-trip in low/normal vol, 0.25% in elevated vol, 0.5% in extreme vol. Confirm profitability at elevated vol spread before approving. Decision heuristic: Before approving any crypto strategy: (a) positive expectancy in at least 3 of 4 structural regimes, (b) fees modeled as regime-dependent not flat, (c) funding rate used as continuous influence.`,
  },
  {
    chunk_id: 'C-06',
    desk: 'crypto',
    applies_to: ['validate_edge_mechanism'],
    title: 'Three Canonical Mechanism Failure Modes — Crypto',
    content: `Arbitrage decay: Crypto markets are more accessible to sophisticated participants than prediction markets. Check whether the edge has been declining over the sample period — that is the arbitrage signature. If the most recent regime window shows materially lower edge without a regime explanation, arbitrage decay is the likely cause. Regime specificity disguised as robustness: A crypto strategy that works in both "low vol" and "high vol" regimes might actually be two different strategies. If the mechanism explanation requires different logic in different regimes, it is two strategies, not one robust strategy. Each component requires independent validation. Execution dependency: Model the strategy with execution at: normal vol = mid + 0.5 spread, elevated vol = mid + 1.0 spread. If the edge disappears, it is a mid-price artifact. Decision heuristic: A mechanism fails crypto validation if: (1) edge is declining over the sample period without regime explanation, (2) mechanism requires different logic in different regimes, or (3) profitability disappears when execution is modeled at bid/ask. Any one caps mechanism_clarity at 0.50.`,
  },
  {
    chunk_id: 'C-07',
    desk: 'crypto',
    applies_to: ['monitor_positions', 'evaluate_circuit_breakers'],
    title: 'Portfolio ENP and Crypto Correlation Structure',
    content: `The Effective Number of Positions (ENP) measures how many genuinely independent bets the portfolio actually contains. A portfolio of 5 BTC and ETH positions that are 90% correlated has ENP close to 1.0. The minimum ENP threshold of 2.0 requires at least 2 genuinely independent risk sources. In crypto, this almost always requires positions from different strategy types — directional BTC and ETH bets are typically 70-85% correlated. BTC dominance risk: when macro stress hits crypto, BTC-ETH correlation converges to 0.90+. A portfolio appearing well-diversified (ENP = 3.0) in normal conditions can collapse to ENP ≈ 1.2 during stress. Rising BTC dominance is a leading indicator of correlation convergence. P&L attribution: if >70% of P&L variance is explained by regime direction, the portfolio is a directional vol bet, not a strategy book. Decision heuristic: If ENP drops below 2.0, check whether positions can be offset or reduced. If ENP is 1.2 or below, treat as a concentration alert equivalent to approaching the drawdown limit. Note: verify exact task type strings manage_crypto_position and place_crypto_limit_order match DB enum values.`,
  },

  // ── Strategy/Risk shared (SR-series) ──────────────────────────────────────
  {
    chunk_id: 'SR-01',
    desk: 'shared',
    applies_to: ['run_backtest', 'run_crypto_backtest', 'detect_overfitting'],
    title: 'Healthy Backtest Metrics Reference',
    content: `Sharpe Ratio benchmarks: In-sample > 2.0 on a simple strategy = red flag (likely overfit). In-sample 0.8-1.5 = reasonable, requires walk-forward confirmation. Out-of-sample 0.5-1.2 = credible. Out-of-sample > 1.5 = unusually strong, verify not regime-specific. IS to OOS degradation: OOS/IS between 0.5 and 1.0 = normal, acceptable. Below 0.5 = significant, requires explanation. OOS Sharpe above IS Sharpe = unusual — do not interpret as "even stronger than measured." Investigate whether the OOS period was unrepresentatively favorable (e.g., strong trend period for a momentum strategy). This is a data artifact flag, not a quality upgrade. Win rate alone is meaningless without the win/loss ratio. Required: (win_rate × avg_win) > ((1 - win_rate) × avg_loss). Regime analysis: positive expectancy in 2/3 regime windows minimum. One regime driving all returns = regime-specific strategy, not general edge. Decision heuristic: If OOS Sharpe is less than 0.5× IS Sharpe, do not approve for forward testing. If OOS Sharpe exceeds IS Sharpe, investigate the OOS period conditions before drawing any conclusions.`,
  },
  {
    chunk_id: 'SR-02',
    desk: 'shared',
    applies_to: ['detect_overfitting', 'challenge_strategy', 'challenge_crypto_strategy'],
    title: 'Overfitting Detection: Four Specific Signatures',
    content: `Parameter sensitivity test: perturb key parameters ±10%. If Sharpe drops >30% with small perturbations, the strategy is fit to specific parameter values rather than a robust relationship. Return concentration test: if >50% of total returns come from <20% of trades, examine those trades independently. Run the backtest excluding the top 10% of trades by absolute return — if the strategy becomes unprofitable, it depends on outlier trades. Complexity penalty: 250 observations per free parameter minimum. A strategy with 4 threshold parameters tested on 200 trades has essentially zero degrees of freedom. Count parameters rigorously — each entry condition, exit condition, and threshold counts separately. Deflated Sharpe concept: a high scan-to-finding ratio (many tests before this finding emerged) requires a higher minimum Sharpe for statistical significance. Treat high ratios as a penalty on any Sharpe threshold. Decision heuristic: If any two of these four signatures are present, decline and request a revised strategy with reduced complexity. One signature alone = caution and flag. Two or more = decline.`,
  },

  // ── B-series (B-01..B-28) — canonical frameworks ─────────────────────────
  // NOTE: Due to size, B-series content is loaded from inline strings below.
  // (All chunks included; exactly 28 B-series entries.)
  {
    chunk_id: 'B-27',
    desk: 'shared',
    applies_to: 'all',
    title: 'The Process-Outcome Matrix: Evaluating Decisions Correctly',
    content: `Decisions must be evaluated by the quality of the process, not the quality of the outcome. This is a logical necessity in any probabilistic system. The process-outcome matrix: - Good process + good outcome = deserved success. Reinforce the process. - Good process + bad outcome = bad luck. Maintain the process, gather more data. - Bad process + good outcome = dumb luck. Identify what was wrong before it produces a bad outcome when luck doesn't compensate. - Bad process + bad outcome = expected failure. Analyze the process failure. The dangerous quadrant is bad process + good outcome. This is where overconfidence develops. A bot that made a confident recommendation with poor reasoning that happened to be correct will score well on outcome metrics but poorly on process metrics. If the system rewards outcomes more than process, it will reinforce bad reasoning that got lucky — which produces confident, systematic errors when luck eventually runs out. Connection to consolidate_memories: when extracting lessons from episodes, always ask "was this a process success or an outcome success?" A correct prediction made for the wrong reasons should generate a different lesson than a correct prediction made for the right reasons. Before finalizing consolidation output, apply the process-outcome test: was a successful episode outcome produced by correct reasoning, or by luck in a favorable regime? Extract the lesson that matches the actual cause. Implication for strategy review: strategies that generated good recent returns during a favorable regime should not receive reduced scrutiny. They should receive the same scrutiny as always, with explicit separation of regime luck from process quality. Decision heuristic: When reviewing any episode outcome, before extracting a lesson, answer: was the reasoning correct given the information available at the time? If yes, the lesson is about what information leads to good outcomes. If no, the lesson is about what reasoning errors to correct — regardless of what the outcome was.`,
  },
];

// B-series: include remaining B-01..B-26 and B-28.
// To keep this file maintainable, we append them programmatically from a literal object.
const B_SERIES: KnowledgeChunk[] = [
  {
    chunk_id: 'B-01',
    desk: 'shared',
    applies_to: ['run_backtest', 'run_crypto_backtest', 'detect_overfitting', 'challenge_strategy', 'challenge_crypto_strategy'],
    title: 'Why Most Backtests Are Lies: The Multiple Testing Framework',
    content: `A backtest does not test whether a strategy works. It tests whether a strategy worked on this specific dataset, during this specific period, with these specific parameters. Every decision made during strategy construction — what data to use, what lookback window, what threshold — is an implicit degree of freedom. Each additional degree of freedom increases the probability that a strategy looks good in backtest but fails live. The mathematics are unforgiving. If you test 50 independent strategies and select the best one, the expected maximum Sharpe ratio from pure noise is approximately 1.2. Not 0 — 1.2. This means a backtest Sharpe of 1.0 is only impressive if you tested very few strategies to produce it. The researcher degrees of freedom problem: even testing one strategy involves many implicit choices — the entry signal formula, the exit rule, the holding period, the stop loss level, the lookback for vol estimation. If you tested 10 variations of each of 6 parameters before settling on a final specification, you implicitly tested 10^6 = one million combinations. The Sharpe ratio of the best combination from one million random strategies is not 0 — it is approximately 4.0 even if none of them have true edge. Three rules that distinguish real signal from backtest artifact: 1. The simpler version of the strategy (fewer parameters, fewer conditions) should perform comparably to the complex version. If it doesn't, the complexity is overfit. 2. Performance should be roughly consistent across sub-periods. A strategy that generates all its returns in one 6-month window is a data artifact, not a strategy. 3. The mechanism should predict when the strategy FAILS as precisely as it predicts when it succeeds. A mechanism that only explains success is post-hoc rationalization. Decision heuristic: Before accepting any backtest result, count the number of implicit decisions made during strategy construction. If the count exceeds 20, treat the result as exploratory only — the strategy requires independent out-of-sample validation before the backtest Sharpe has any meaning.`,
  },
  {
    chunk_id: 'B-02',
    desk: 'shared',
    applies_to: ['run_backtest', 'run_crypto_backtest', 'detect_overfitting'],
    title: 'The Deflated Sharpe Ratio: Adjusting for Selection Bias',
    content: `The standard Sharpe ratio assumes the strategy being evaluated was selected independently of the data used to evaluate it. When a strategy was selected because it looked good on historical data, the Sharpe ratio is inflated — often dramatically. The Deflated Sharpe Ratio corrects for this selection bias. The conceptual adjustment: the minimum Sharpe ratio required to achieve statistical significance increases as a function of (1) how many strategies were tested, (2) the non-normality of returns — specifically skewness and kurtosis — and (3) the length of the track record. The actual calculation requires knowing these inputs precisely; what follows is a practical calibration, not a derived formula. Rough calibration for typical trading strategy returns (moderate negative skewness, moderate excess kurtosis, 100 observations): - Single a priori hypothesis: minimum Sharpe ≈ 0.9 at 95% confidence - 10 strategies tested: minimum Sharpe ≈ 1.4 - 50 strategies tested: minimum Sharpe ≈ 1.9 - 100 strategies tested: minimum Sharpe ≈ 2.2 The doubling rule of thumb: for every 10x increase in the number of strategies tested, the minimum Sharpe for significance roughly doubles. This is an approximation — the actual relationship depends on return distribution properties — but it is directionally correct and more useful than ignoring the correction entirely. Why non-normality matters: trading returns have fat tails and negative skewness. The standard Sharpe treats all variance equally, making it insensitive to the tail behavior that matters most. A strategy with Sharpe 1.0 but significant negative skewness is riskier than the same Sharpe with normally distributed returns. Decision heuristic: For every finding, ask: "How many scans produced nothing before this one?" As a rough guide: if the scan-to-finding ratio exceeds 20:1, treat the in-sample Sharpe as requiring a 50% haircut before evaluation.`,
  },
  {
    chunk_id: 'B-03',
    desk: 'shared',
    applies_to: ['score_rqs', 'challenge_strategy', 'challenge_crypto_strategy'],
    title: 'Why Published Factors Decay: The P-Hacking Problem in Finance',
    content: `Academic finance has published hundreds of factors claimed to predict returns. The majority of them fail out-of-sample. The reason is systematic: researchers test many specifications, select the ones that produce significant t-statistics, and publish. The failed tests are never seen. The empirically documented decay: across multiple studies of previously published equity return factors evaluated on out-of-sample data, a substantial fraction of originally documented alpha disappears post-publication. Three mechanisms drive decay: publication (capital flows in and arbitrages the edge), data mining (noise patterns that don't persist), and small sample (insufficient observations to distinguish genuine from spurious effects). What makes a factor genuinely robust: first-principles mechanism predicted theoretically not discovered empirically; works in markets and time periods not used in discovery; simpler version performs as well as complex version; effect larger when mechanism is most likely to operate. Decision heuristic: Any finding resembling a known published factor — momentum, mean reversion, carry, value — should be assumed to be partially arbitraged until proven otherwise.`,
  },
  {
    chunk_id: 'B-04',
    desk: 'shared',
    applies_to: ['validate_edge_mechanism', 'score_rqs'],
    title: 'Why Edges Persist and How They Die: Limits of Arbitrage and the Adaptive Markets Framework',
    content: `Two questions appear separate but are actually one: "Why does this mispricing persist?" and "Where is this edge in its life cycle?" The life cycle phase determines which limit of arbitrage is operative. Structural frictions: capital constraints, convergence risk, implementation frictions. Life cycle: discovery, growth, maturity, extinction. For Kalshi: most microstructure strategies are early growth phase. For crypto: most funding rate strategies are maturity phase. Decision heuristic: Before assigning mechanism_clarity above 0.65, answer: (1) Which specific limit of arbitrage allows this mispricing to persist? (2) Which life cycle phase is this edge in?`,
  },
  {
    chunk_id: 'B-05',
    desk: 'shared',
    applies_to: ['run_backtest', 'challenge_strategy', 'challenge_crypto_strategy', 'detect_overfitting'],
    title: 'What Consistently Profitable Traders Actually Believe',
    content: `Across decades of practitioners, consistent beliefs emerge. On losses: a large loss is evidence your understanding was wrong; ask if mechanism is intact. On conviction and size: size best ideas more heavily; don't diversify uniformly. On being wrong: distinguish direction vs timing vs positioning. On mechanism vs pattern: mechanisms are more robust than patterns alone. On risk: not-losing is primary; compounding asymmetry makes this rational. Decision heuristic: For any strategy under review, ask: "If this strategy loses 20% in the first 10 trades, do we still believe in the mechanism?"`,
  },
  {
    chunk_id: 'B-06',
    desk: 'shared',
    applies_to: ['size_position', 'monitor_positions'],
    title: 'Kelly Criterion: The Mathematics of Optimal Bet Sizing',
    content: `Note: This chunk is the canonical Kelly reference. Kelly criterion maximizes the long-run geometric growth rate of wealth. Formula: f* = (bp - q) / b. Use fractional Kelly: f = 0.25 × f*. Estimation error makes full Kelly fragile. Correlation adjustment is mandatory: multiply base fraction by (1 - portfolio_correlation_to_new_bet). Drawdown is Bayesian evidence: recompute edge downward after drawdowns; the drawdown table operationalizes this. Decision heuristic: Final size = 0.25 × Kelly(edge) × (1 - correlation) × drawdown_multiplier; show this calculation explicitly.`,
  },
  {
    chunk_id: 'B-07',
    desk: 'shared',
    applies_to: ['monitor_positions', 'attribute_performance'],
    title: 'The Fundamental Law of Active Management',
    content: `Information Ratio = IC × √BR. Breadth only helps if bets are independent; correlation reduces effective breadth. IS approximates IC: IS=0.10 is valuable if applied consistently with breadth. State transitions should be tentative with <50 episodes. Decision heuristic: adding strategies should increase effective breadth; if correlation >0.8 to existing book, breadth addition is negligible — decline.`,
  },
  {
    chunk_id: 'B-08',
    desk: 'shared',
    applies_to: ['score_rqs', 'run_backtest', 'run_crypto_backtest', 'detect_overfitting', 'consolidate_memories', 'attribute_performance'],
    title: 'System 1 and System 2: The Cognitive Architecture of Bias',
    content: `System 1 is fast pattern-matching; System 2 is slow rule-governed. Biases: anchoring, base rate neglect, narrative coherence, representativeness, availability, overconfidence. Templates impose System 2 structure. Decision heuristic: If you reach a conclusion before completing all steps of the reasoning structure, stop and restart from step 1.`,
  },
  {
    chunk_id: 'B-09',
    desk: 'shared',
    applies_to: ['score_rqs', 'run_backtest', 'run_crypto_backtest', 'attribute_performance'],
    title: 'Core Biases in Probabilistic Judgment',
    content: `Base rate neglect, representativeness, conjunction fallacy, regression to mean, law of small numbers, hindsight bias. Decision heuristic: before finalizing any probability: (1) base rate, (2) evidence independence, (3) would you estimate same without knowing direction?`,
  },
  {
    chunk_id: 'B-10',
    desk: 'shared',
    applies_to: ['assess_strategic_priorities', 'detect_systematic_blind_spots', 'consolidate_memories'],
    title: 'What Makes a Good Forecaster: Superforecaster Principles',
    content: `Use precise probabilities internally; update frequently and proportionally; seek disconfirming evidence; decompose questions. Translate probabilities to clear directives in human-facing briefs. Decision heuristic: write the best case against your conclusion; if you can't, it's not ready.`,
  },
  {
    chunk_id: 'B-11',
    desk: 'shared',
    applies_to: ['generate_daily_report', 'generate_weekly_memo', 'generate_daily_brief'],
    title: 'The Pyramid Principle: Leading with the Answer',
    content: `Lead with the conclusion, then support it (MECE). For daily brief: SYSTEM STATE first, then ACTION REQUIRED, then evidence. Empty ACTION REQUIRED on good days is discipline. Decision heuristic: write SYSTEM STATE before anything else.`,
  },
  {
    chunk_id: 'B-12',
    desk: 'shared',
    applies_to: ['generate_daily_report', 'generate_weekly_memo', 'generate_daily_brief'],
    title: 'Information Density: Every Element Must Earn Its Place',
    content: `Signal-to-noise ratio matters. Report metrics with reference points and directional context. Delete sentences that do not change what the reader thinks or does. Decision heuristic: remove anything accurate-but-non-actionable.`,
  },
  {
    chunk_id: 'B-13',
    desk: 'shared',
    applies_to: ['monitor_positions', 'evaluate_circuit_breakers'],
    title: 'Antifragility and Circuit Breaker Design',
    content: `Circuit breakers convert fragile strategies into robust ones by capping losses and removing human judgment under stress. They halt new positions, evaluate automatically, and escalate only when classification is ambiguous. Decision heuristic: classify trigger first (fundamental vs transient); never force liquidation immediately.`,
  },
  {
    chunk_id: 'B-14',
    desk: 'shared',
    applies_to: ['evaluate_circuit_breakers', 'monitor_positions'],
    title: 'How Financial Systems Generate Their Own Crises',
    content: `Crises can be endogenous: tight coupling and feedback loops amplify shocks. Crowding causes correlated exits. ENP monitoring detects correlation convergence. Decision heuristic: simultaneous losses + declining ENP: classify as regime vs crowding; waiting can be better than joining forced selling.`,
  },
  {
    chunk_id: 'B-15',
    desk: 'shared',
    applies_to: ['publish_regime_state', 'monitor_positions'],
    title: 'Regime Switching: How Markets Change States',
    content: `Regimes persist; transitions are asymmetric (fast up, slow down) and correlation converges during transitions. Use leading indicators; classify TRANSITIONING when multiple indicators align. Decision heuristic: reduce exposure quickly when vol rises; restore slowly.`,
  },
  {
    chunk_id: 'B-16',
    desk: 'shared',
    applies_to: ['attribute_performance', 'consolidate_memories'],
    title: 'Measuring Genuine Skill in Repeated Decisions',
    content: `Detecting IC=0.10 requires ~400 independent observations. Calibration can be measured with 30-50. State transitions near boundaries require more confirmation. Decision heuristic: before transitioning: episodes>50, IS not near boundary, calibration consistent.`,
  },
  {
    chunk_id: 'B-17',
    desk: 'shared',
    applies_to: ['challenge_strategy', 'challenge_crypto_strategy', 'review_regime_strategy_alignment'],
    title: 'Second-Level Thinking and Cycle Awareness',
    content: `Second-level thinking compares to alternatives/consensus. Regime-strategy alignment depends on regime when validated vs now. Don’t extrapolate high-IS periods without calibration. Decision heuristic: scale-ups require calibration improvement, not just outcomes.`,
  },
  {
    chunk_id: 'B-18',
    desk: 'shared',
    applies_to: ['volume_anomaly_detect', 'funding_rate_scan', 'crypto_volume_profile'],
    title: 'Informed Trading: How to Detect It in Order Flow',
    content: `Informed traders are takers; look for sustained order flow imbalance and sticky price moves. Distinguish accumulation vs reaction patterns. Decision heuristic: volume anomaly is higher RQS when taker volume is disproportionately elevated.`,
  },
  {
    chunk_id: 'B-19',
    desk: 'prediction',
    applies_to: ['market_trend_scan', 'score_rqs'],
    title: 'How Information Aggregates in Prediction Markets',
    content: `Aggregation requires many independent participants + liquidity + clear resolution. Thin markets behave differently; prices can be biased. Decision heuristic: volumes >$500k likely well-aggregated; <$50k thin and mispricing more likely but needs confirmation.`,
  },
  {
    chunk_id: 'B-20',
    desk: 'prediction',
    applies_to: ['run_backtest', 'formalize_strategy'],
    title: 'Binary Contract Pricing: When Market Prices Are Biased',
    content: `Prices deviate from true probabilities due to risk aversion, transaction costs, thin market premia. Fee structure peaks mid-range. Decision heuristic: for <0.25 or >0.75 priced contracts, model fee+bias+spread explicitly.`,
  },
  {
    chunk_id: 'B-21',
    desk: 'crypto',
    applies_to: ['validate_edge_mechanism', 'run_crypto_backtest'],
    title: 'Momentum Research: What the Academic Evidence Actually Covers',
    content: `Academic momentum evidence is mostly monthly horizons in traditional markets; it doesn’t directly validate 1-5 day crypto momentum. Use it as mechanism prior, not pattern evidence. Decision heuristic: lookback<20d requires OOS confirmation in 2 regimes.`,
  },
  {
    chunk_id: 'B-22',
    desk: 'shared',
    applies_to: ['run_backtest', 'run_crypto_backtest', 'detect_overfitting'],
    title: 'The Correct Statistical Tests for Strategy Validation',
    content: `Sharpe assumes iid normal returns; trading returns are autocorrelated and non-normal. Use permutation tests and bootstrap CIs; report effective sample size. Decision heuristic: with <252 effective observations, note underpowered validation explicitly.`,
  },
  {
    chunk_id: 'B-23',
    desk: 'shared',
    applies_to: ['formalize_strategy', 'run_backtest', 'run_crypto_backtest'],
    title: 'Mean Reversion vs Momentum: The Strategic Choice',
    content: `Mean reversion vs momentum have opposite regime dependencies and holding period requirements. Formalization must classify. Decision heuristic: if strategy type and holding period mismatch, decline.`,
  },
  {
    chunk_id: 'B-24',
    desk: 'shared',
    applies_to: ['size_position', 'monitor_positions'],
    title: 'Portfolio ENP: The Effective Number of Independent Bets',
    content: `ENP via eigenvalues: (Σλ)^2/(Σλ^2). Crisis convergence collapses ENP. Decision heuristic: monitor ENP trend; declining ENP triggers resizing even before thresholds breached.`,
  },
  {
    chunk_id: 'B-25',
    desk: 'shared',
    applies_to: ['attribute_performance', 'consolidate_memories'],
    title: 'Performance Attribution: Separating Regime from Skill',
    content: `Decompose performance into regime contribution vs skill contribution; IS scores are not comparable across regimes. Decision heuristic: compare IS to regime-expected IS, not absolute.`,
  },
  {
    chunk_id: 'B-26',
    desk: 'shared',
    applies_to: ['consolidate_memories'],
    title: 'Cross-Desk Learning: When Does a Pattern Generalize?',
    content: `Generalize only when mechanisms operate through shared drivers. Resolution mechanics and funding are desk-specific. Require 3 confirmations on receiving desk. Decision heuristic: distribute mechanism analysis; mark desk-specific when structure differs.`,
  },
  {
    chunk_id: 'B-28',
    desk: 'shared',
    applies_to: ['validate_edge_mechanism', 'score_rqs'],
    title: 'Falsifiability as a Quality Test for Mechanisms',
    content: `Mechanisms must be falsifiable: write specific predictions about when edge will not work. Non-falsifiable stories cap mechanism_clarity. Decision heuristic: write 3 specific non-edge conditions; if you can’t write one, mechanism_clarity ≤ 0.40.`,
  },
];

CHUNKS.push(...B_SERIES);

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const c of CHUNKS) {
    const res = await insertChunk(c);
    if (res === 'inserted') inserted += 1;
    else skipped += 1;
  }

  console.log('Seeded knowledge_library chunks.', { total: CHUNKS.length, inserted, skipped });

  // sanity check: expect 52
  if (CHUNKS.length !== 52) {
    throw new Error(`Expected 52 chunks, got ${CHUNKS.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

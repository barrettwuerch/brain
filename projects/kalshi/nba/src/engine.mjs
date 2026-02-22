import { nowMs } from './util.mjs';

export function computeMidProbFromTob(tob) {
  if (!Number.isFinite(tob?.midLockedC)) return null;
  return tob.midLockedC / 100;
}

export function gameQuarterFromEspn(gs) {
  const q = Number(gs?.quarter);
  return Number.isFinite(q) ? q : null;
}

export function isQ4OrLater(gs) {
  const q = gameQuarterFromEspn(gs);
  return q != null && q >= 4;
}

export function isGameStateStale(gs, now = nowMs()) {
  const t = Number(gs?.updatedAtMs);
  if (!Number.isFinite(t)) return true;
  return (now - t);
}

export function shouldEnter({
  gameId,
  ticker,
  tob,
  depthNearMid,
  micro,
  stateGame,
  gs,
  cfg,
  alreadyTraded,
}) {
  const t = nowMs();

  if (alreadyTraded) return { ok: false, skip_reason: 'already_traded', t, gameId, ticker };

  // Baseline required; never infer.
  const baseline = stateGame?.pregameLockedProb;
  if (!Number.isFinite(baseline)) {
    return { ok: false, skip_reason: 'no_baseline', t, gameId, ticker };
  }

  // Game state required
  if (!gs?.ok) {
    return { ok: false, skip_reason: 'stale_game_state', t, gameId, ticker, gsReason: gs?.reason || null };
  }

  // If ESPN returns ok but required fields are missing, treat as stale/invalid.
  if (!Number.isFinite(Number(gs.quarter)) || gs.clockSec === null || gs.clockSec === undefined) {
    return { ok: false, skip_reason: 'stale_game_state', t, gameId, ticker, gsReason: 'missing_period_or_clock' };
  }

  // Staleness gate: blocks entries only.
  const ageMs = isGameStateStale(gs, t);
  if (ageMs > cfg.gameState.staleFreezeEntryMs) {
    return { ok: false, skip_reason: 'stale_game_state', t, gameId, ticker, ageMs };
  }

  // Quarter gate
  if (!cfg.rules.allowQuarters.includes(gs.quarter)) {
    return { ok: false, skip_reason: 'q4_or_later', t, gameId, ticker, quarter: gs.quarter };
  }

  // Baseline favorite gate
  if (baseline < cfg.probability.pregameLockMinProb) {
    return { ok: false, skip_reason: 'pregame_below_threshold', t, gameId, ticker, baseline };
  }

  // Losing gate: favorite team must be trailing.
  // Determine if this market is the favorite team.
  // Market ticker ends with -<TEAM> in our observations.
  const team = String(ticker).split('-').at(-1);

  const homeAbbr = stateGame?.parsed?.home;
  const awayAbbr = stateGame?.parsed?.away;
  const homeScore = gs.homeScore;
  const awayScore = gs.awayScore;

  // If scores are missing, cannot validate.
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return { ok: false, skip_reason: 'no_scores', t, gameId, ticker };
  }

  // Determine favorite team: baseline is stored per game, but baseline pertains to the favorite.
  // In v0 we treat the team with baseline>=0.65 as the favorite team *for that game*, but we
  // still need to map baseline to a specific team. We store favoriteTeam on lock.
  const favoriteTeam = stateGame?.favoriteTeam;
  if (!favoriteTeam) {
    return { ok: false, skip_reason: 'no_favorite_team', t, gameId, ticker };
  }

  if (team !== favoriteTeam) {
    return { ok: false, skip_reason: 'not_favorite_team_market', t, gameId, ticker, team, favoriteTeam };
  }

  const favoriteIsHome = (favoriteTeam === homeAbbr);
  const favScore = favoriteIsHome ? homeScore : awayScore;
  const oppScore = favoriteIsHome ? awayScore : homeScore;
  if (!(favScore < oppScore)) {
    return { ok: false, skip_reason: 'not_losing', t, gameId, ticker, favScore, oppScore };
  }

  // Microstructure gates
  if (micro?.skip) {
    return { ok: false, skip_reason: 'spread_too_wide', t, gameId, ticker, spreadC: tob?.spreadC ?? null };
  }
  if (depthNearMid < cfg.execution.minDepthContractsNearMid) {
    return { ok: false, skip_reason: 'depth_too_low', t, gameId, ticker, depthNearMid };
  }

  const midProb = computeMidProbFromTob(tob);
  if (midProb == null) return { ok: false, skip_reason: 'no_mid', t, gameId, ticker };

  if (midProb < cfg.probability.entryMinProb || midProb > cfg.probability.entryMaxProb) {
    return { ok: false, skip_reason: 'prob_out_of_window', t, gameId, ticker, midProb };
  }

  return {
    ok: true,
    t,
    gameId,
    ticker,
    midProb,
    baseline,
    quarter: gs.quarter,
    clockSec: gs.clockSec,
    homeScore,
    awayScore,
  };
}

export function shouldExit({ gameId, ticker, tob, gs, cfg, position, score_deficit = null, now = nowMs() }) {
  if (!position || position.status !== 'open') return { ok: false, skip_reason: 'no_open_position' };
  if (!gs?.ok) {
    // If no game state, do nothing here; staleness handler will decide safety exit.
    return { ok: false, skip_reason: 'no_game_state' };
  }

  const midProb = computeMidProbFromTob(tob);
  if (midProb == null) return { ok: false, skip_reason: 'no_mid' };

  // Forced close: Q4 with <= 0:30 remaining
  if (Number(gs.quarter) === 4 && Number.isFinite(gs.clockSec) && gs.clockSec <= 30) {
    return { ok: true, reason: 'q4_0m30_forced', midProb };
  }

  // Target
  if (midProb >= cfg.probability.exitTargetProb) return { ok: true, reason: 'target_hit', midProb };

  // Rule B stop logic
  // - if deficit <= 8 => no stop
  // - else stop at cfg.probability.exitStopProb
  const d = Number(score_deficit);
  const stopDisabled = Number.isFinite(d) && d <= 8;
  if (!stopDisabled && midProb < cfg.probability.exitStopProb) {
    return { ok: true, reason: 'stop_loss', midProb, score_deficit: d };
  }

  return { ok: false, skip_reason: 'hold', midProb };
}

import { nowMs } from './util.mjs';

/**
 * ESPN dev provider (placeholder).
 *
 * v0 plan:
 * - map Kalshi game -> ESPN event id
 * - fetch summary/scoreboard
 * - normalize to: { gameId, quarter, clockSec, homeScore, awayScore, favoriteIsLosing, updatedAtMs }
 */

export async function fetchGameState({ /* game */ }) {
  // TODO: implement ESPN hidden API integration.
  // For now return null so the bot runs in "market-only shadow" mode.
  return {
    ok: false,
    reason: 'espn_provider_not_implemented',
    updatedAtMs: nowMs(),
  };
}

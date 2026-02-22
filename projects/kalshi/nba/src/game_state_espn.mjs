import { nowMs } from './util.mjs';
import { fetchEspnNbaScoreboard } from './espn_scoreboard.mjs';

/**
 * ESPN game-state provider.
 *
 * We use the ESPN NBA scoreboard for the game date and match by team abbreviations.
 */

function parseClockToSeconds(displayClock) {
  if (!displayClock) return null;
  const m = String(displayClock).match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function toEspnAbbr(a) {
  // Kalshi tickers use 3-letter team codes; ESPN sometimes uses 2-letter codes.
  const m = {
    GSW: 'GS',
    SAS: 'SA',
    NOP: 'NO',
  };
  return m[a] || a;
}

export async function fetchGameStateEspn({ isoDate, awayAbbr, homeAbbr }) {
  const sb = await fetchEspnNbaScoreboard({ isoDate });
  const awayE = toEspnAbbr(awayAbbr);
  const homeE = toEspnAbbr(homeAbbr);
  const key = `${awayAbbr}${homeAbbr}`;

  const g = sb.games.find(x => x.awayAbbr === awayE && x.homeAbbr === homeE);
  if (!g) {
    return {
      ok: false,
      provider: 'espn',
      reason: 'game_not_found',
      updatedAtMs: nowMs(),
      isoDate,
      key,
      requested: { awayAbbr, homeAbbr, awayE, homeE },
      availableGames: sb.games.map(x => `${x.awayAbbr}${x.homeAbbr}`),
    };
  }

  return {
    ok: true,
    provider: 'espn',
    updatedAtMs: sb.fetchedAtMs,
    isoDate,
    key,
    espnEventId: g.espnEventId,
    quarter: g.period,
    clockSec: parseClockToSeconds(g.displayClock),
    clockDisplay: g.displayClock,
    state: g.state,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    scheduledStartIso: g.scheduledStartIso,
    scheduledStartMs: g.scheduledStartMs,
  };
}

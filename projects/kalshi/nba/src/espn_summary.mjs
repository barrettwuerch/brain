import { nowMs } from './util.mjs';

export async function fetchEspnNbaSummary({ eventId }) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${encodeURIComponent(eventId)}`;
  const t0 = nowMs();
  const res = await fetch(url, {
    headers: {
      'user-agent': 'OpenClaw-Kalshi-NBA-Bot/0.1',
      'accept': 'application/json,text/plain,*/*',
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data) {
    const err = new Error(`ESPN summary HTTP ${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    throw err;
  }
  return { fetchedAtMs: t0, eventId, data };
}

function parseClock(clockDisplay) {
  if (clockDisplay === null || clockDisplay === undefined) return null;
  const s = String(clockDisplay).trim();
  if (!s) return null;
  const m = s.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function periodElapsedSec(period, clockSec, periodLenSec = 12 * 60) {
  // period is 1-based. clockSec = seconds remaining.
  if (!Number.isFinite(period) || !Number.isFinite(clockSec)) return null;
  const elapsedInPeriod = periodLenSec - clockSec;
  return (period - 1) * periodLenSec + elapsedInPeriod;
}

/**
 * Build a wallclock-indexed game state timeline from ESPN plays.
 * Output: sorted array of { tSec, period, clockSec, homeScore, awayScore }
 *
 * This is critical: Kalshi candlesticks are in REAL TIME. We must map candle timestamps to
 * ESPN game state using ESPN play wallclock timestamps (not using a naive 12-min quarter mapping).
 */
export function buildStateTimelineFromSummary(summaryData) {
  const plays = summaryData?.data?.plays || summaryData?.plays || [];
  const out = [];

  for (const p of plays) {
    const wall = p?.wallclock;
    const tMs = wall ? Date.parse(wall) : null;
    if (!tMs) continue;

    const period = Number(p?.period?.number ?? p?.period ?? p?.periodNumber);
    const clockSec = parseClock(p?.clock?.displayValue ?? p?.clock);
    const homeScore = Number(p?.homeScore);
    const awayScore = Number(p?.awayScore);

    if (!Number.isFinite(period) || !Number.isFinite(clockSec)) continue;
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    out.push({ tSec: Math.floor(tMs / 1000), period, clockSec, homeScore, awayScore });
  }

  out.sort((a, b) => a.tSec - b.tSec);
  return out;
}

export function stateAtOrBefore(timeline, tSec) {
  // binary search for rightmost timeline[i].tSec <= tSec
  let lo = 0, hi = timeline.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].tSec <= tSec) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans >= 0 ? timeline[ans] : null;
}

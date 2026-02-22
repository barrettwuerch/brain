import { nowMs } from './util.mjs';

function yyyymmdd(isoDate /* YYYY-MM-DD */) {
  return String(isoDate).replaceAll('-', '');
}

export async function fetchEspnNbaScoreboard({ isoDate /* YYYY-MM-DD */ }) {
  const dates = yyyymmdd(isoDate);
  // ESPN scoreboard endpoint (returns period/displayClock/scores)
  // Confirmed working (HTTP 200):
  //   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dates}`;
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
    const err = new Error(`ESPN scoreboard HTTP ${res.status}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    throw err;
  }

  const events = Array.isArray(data.events) ? data.events : [];
  const games = [];

  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    const comps = comp?.competitors || [];
    const home = comps.find(c => c?.homeAway === 'home');
    const away = comps.find(c => c?.homeAway === 'away');

    const homeAbbr = home?.team?.abbreviation;
    const awayAbbr = away?.team?.abbreviation;

    const homeScore = Number(home?.score);
    const awayScore = Number(away?.score);

    const period = Number(comp?.status?.period);
    const displayClock = comp?.status?.displayClock;
    const state = comp?.status?.type?.state; // pre|in|post

    const scheduledStartIso = comp?.date || ev?.date || null;
    const scheduledStartMs = scheduledStartIso ? Date.parse(scheduledStartIso) : null;

    if (!homeAbbr || !awayAbbr) continue;

    games.push({
      espnEventId: ev?.id,
      awayAbbr,
      homeAbbr,
      homeScore: Number.isFinite(homeScore) ? homeScore : null,
      awayScore: Number.isFinite(awayScore) ? awayScore : null,
      period: Number.isFinite(period) ? period : null,
      displayClock: displayClock ?? null,
      state: state ?? null,
      scheduledStartIso,
      scheduledStartMs,
    });
  }

  return { fetchedAtMs: t0, isoDate, games, rawCount: events.length };
}

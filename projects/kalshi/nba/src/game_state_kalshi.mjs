import { nowMs } from './util.mjs';

/**
 * Attempt to read game state (quarter/clock/score) from Kalshi endpoints.
 *
 * Rationale: Kalshi UI clearly has these fields; they may be present in /events/{event_ticker}
 * or /markets/{ticker}. If so, we can drop ESPN dependency for v0.
 */

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export async function fetchGameStateFromKalshi({ client, eventTicker, marketTicker }) {
  const t = nowMs();
  const out = {
    ok: false,
    provider: 'kalshi',
    updatedAtMs: t,
    eventTicker,
    marketTicker,
  };

  // 1) Try event endpoint
  try {
    if (eventTicker) {
      const ev = await client.getEvent(eventTicker);
      // We don't yet know the schema; probe likely locations.
      const e = ev?.event || ev?.data?.event || ev;
      out.rawKeys = Object.keys(e || {}).slice(0, 50);

      const quarter = pick(e, ['quarter', 'period', 'current_quarter', 'currentPeriod']);
      const clock = pick(e, ['clock', 'clock_remaining', 'clockRemaining', 'time_remaining', 'timeRemaining']);
      const homeScore = pick(e, ['home_score', 'homeScore']);
      const awayScore = pick(e, ['away_score', 'awayScore']);

      if (quarter !== undefined || clock !== undefined || homeScore !== undefined || awayScore !== undefined) {
        return {
          ok: true,
          provider: 'kalshi',
          updatedAtMs: t,
          eventTicker,
          marketTicker,
          quarter,
          clock,
          homeScore,
          awayScore,
        };
      }

      out.reason = 'no_game_state_fields_on_event';
    }
  } catch (e) {
    out.reason = 'event_endpoint_failed';
    out.error = String(e?.message || e);
  }

  // 2) Try market endpoint
  try {
    if (marketTicker) {
      const mk = await client.getMarket(marketTicker);
      const m = mk?.market || mk?.data?.market || mk;
      out.rawMarketKeys = Object.keys(m || {}).slice(0, 50);

      const quarter = pick(m, ['quarter', 'period', 'current_quarter', 'currentPeriod']);
      const clock = pick(m, ['clock', 'clock_remaining', 'clockRemaining', 'time_remaining', 'timeRemaining']);
      const homeScore = pick(m, ['home_score', 'homeScore']);
      const awayScore = pick(m, ['away_score', 'awayScore']);

      if (quarter !== undefined || clock !== undefined || homeScore !== undefined || awayScore !== undefined) {
        return {
          ok: true,
          provider: 'kalshi',
          updatedAtMs: t,
          eventTicker,
          marketTicker,
          quarter,
          clock,
          homeScore,
          awayScore,
        };
      }

      out.reason = out.reason || 'no_game_state_fields_on_market';
    }
  } catch (e) {
    out.reason = out.reason || 'market_endpoint_failed';
    out.error2 = String(e?.message || e);
  }

  return out;
}

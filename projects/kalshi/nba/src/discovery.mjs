import { parseNbaEventTicker } from './nba_ticker_parse.mjs';

/**
 * Discover open NBA game-winner markets.
 * Locked logic:
 *   GET /trade-api/v2/markets?series_ticker=KXNBAGAME&status=open
 */
export async function discoverNbaMarkets({ client, seriesTicker }) {
  const resp = await client.getMarkets({ series_ticker: seriesTicker, status: 'open' });
  const markets = resp?.markets || resp?.data?.markets || [];
  const out = [];
  for (const m of markets) {
    const ticker = m.ticker;
    const eventTicker = m.event_ticker || m.eventTicker;
    const parsed = parseNbaEventTicker(eventTicker);
    out.push({
      ticker,
      eventTicker,
      parsed,
      openTime: m.open_time || m.openTime || null,
      closeTime: m.close_time || m.closeTime || null,
      raw: m,
    });
  }
  return out;
}

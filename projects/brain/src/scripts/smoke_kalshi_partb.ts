import 'dotenv/config';

import {
  getBalance,
  getMarkets,
  getOrderbook,
  getOrders,
  getPositions,
  placeOrder,
} from '../lib/kalshi';

async function main() {
  const bal = await getBalance();
  const positions = await getPositions();

  const markets = await getMarkets({ status: 'open', limit: 5 });
  const pick = markets.find((m) => m.ticker && m.status === 'open') ?? markets[0];

  let orderbook: any = null;
  if (pick?.ticker) {
    orderbook = await getOrderbook(pick.ticker);
  }

  // Optional order placement (demo hygiene): only if explicitly enabled.
  let placed: any = null;
  if (String(process.env.KALSHI_SMOKE_PLACE_ORDER ?? '') === '1') {
    if (!pick?.ticker) throw new Error('No market ticker available to place order');

    placed = await placeOrder({
      ticker: pick.ticker,
      client_order_id: `smoke-${Date.now()}`,
      side: 'yes',
      action: 'buy',
      type: 'limit',
      count: 1,
      yes_price: 1,
    });
  }

  const orders = await getOrders({ status: 'open' });

  console.log({
    env: process.env.KALSHI_ENV,
    balance_cents: bal.balance,
    payout_cents: bal.payout,
    positions_count: positions.length,
    markets_count: markets.length,
    sample_market: pick ? { ticker: pick.ticker, title: pick.title, yes_bid: pick.yes_bid, yes_ask: pick.yes_ask, volume: pick.volume } : null,
    orderbook_sample: orderbook
      ? {
          ticker: orderbook.ticker,
          yes_top_bid: orderbook.yes.bids[0] ?? null,
          yes_top_ask: orderbook.yes.asks[0] ?? null,
        }
      : null,
    placed_order: placed ? { id: placed.id, ticker: placed.ticker, status: placed.status } : null,
    open_orders_count: orders.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

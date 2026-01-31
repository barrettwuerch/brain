# Sources / endpoints (Phase 1)

## Polymarket
- 15m market listing page (scraped to discover current event slugs):
  - https://polymarket.com/crypto/15M

## Gamma API (public JSON)
- Resolve event metadata + market fields by slug:
  - https://gamma-api.polymarket.com/events?slug=<event-slug>
  - Provides outcomes and `clobTokenIds` (token ids aligned to outcomes).

## CLOB API (public JSON)
- Orderbook by token id:
  - https://clob.polymarket.com/book?token_id=<token-id>
  - Returns bids/asks arrays (price, size).

## Coinbase spot
- Ticker endpoints:
  - https://api.exchange.coinbase.com/products/BTC-USD/ticker
  - https://api.exchange.coinbase.com/products/ETH-USD/ticker


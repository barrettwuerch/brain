export const ADAPTERS = {
  kalshi: {
    marketType: 'prediction' as const,
    name: 'Kalshi Prediction Markets',
    desk: 'prediction_markets',
    active: true,
  },
  alpaca_crypto: {
    marketType: 'crypto' as const,
    name: 'Alpaca Crypto',
    desk: 'crypto_markets',
    active: false, // activated when adapter is built
  },
} as const;

export type AdapterKey = keyof typeof ADAPTERS;

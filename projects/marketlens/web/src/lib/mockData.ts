import type { Insight } from '../types';

// Fallback mock data for UI development when DB is empty.
// NOTE: This is intentionally minimal and uses DB-shaped fields.

export const MOCK_INSIGHTS: Insight[] = [
  {
    id: 'mock-1',
    story_ids: ['s1', 's2'],
    headline: 'SCOTUS Tariff Ruling — Refund Pipeline Opens',
    thesis: 'Import-heavy firms may see margin relief; refund timing may be mispriced.',
    sectors: ['Consumer Retail', 'Auto'],
    tickers: ['AMZN', 'TGT', 'TM'],
    direction: 'bullish',
    conviction: 5,
    time_horizon: 'weeks',
    second_order: ['Refund litigation timeline creates a delayed catalyst window.'],
    risks: ['Replacement tariffs partially offset relief.'],
    educational_context: 'IEEPA emergency powers context and why the ruling matters.',
    created_at: new Date().toISOString(),
  },
];

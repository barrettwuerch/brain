// Market Lens shared types (importable by worker + web)

export type StoryCategory =
  | 'legal'
  | 'regulatory'
  | 'earnings'
  | 'macro'
  | 'geopolitical'
  | 'sector'
  | 'sentiment'
  | 'other';

export interface Story {
  id: string;
  source: string;
  url: string;
  title: string;
  body?: string | null;
  published_at?: string | null;
  ingested_at?: string | null;
  category?: StoryCategory | null;
  is_processed: boolean;
  url_hash?: string | null;
  content_hash?: string | null;
}

export type InsightDirection = 'bullish' | 'bearish' | 'mixed' | 'unclear';
export type TimeHorizon = 'days' | 'weeks' | 'months' | 'quarters' | 'years';

export interface Insight {
  id: string;
  story_ids: string[];

  headline: string;
  thesis: string;
  details?: string | null;

  sectors: string[];
  tickers: string[];

  direction: InsightDirection;
  conviction: 1 | 2 | 3 | 4 | 5;
  time_horizon: TimeHorizon;

  second_order: string[];
  risks: string[];
  educational_context?: string | null;

  created_at?: string | null;
}

export interface SourceLink {
  url: string;
  source: string;
  published_at: string;
  title?: string;
}

// Optional: structure the analysis output separately from DB row
export interface InsightDraft {
  story_ids: string[];
  headline: string;
  thesis: string;
  direction: InsightDirection;
  conviction: 1 | 2 | 3 | 4 | 5;
  time_horizon: TimeHorizon;
  sectors?: string[];
  tickers?: string[];
  second_order?: string[];
  risks?: string[];
  educational_context?: string;
  details?: string;
}

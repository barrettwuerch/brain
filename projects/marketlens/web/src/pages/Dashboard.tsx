import { useEffect, useMemo, useState } from 'react';

import type { Insight } from '../types';
import { supabase } from '../lib/supabase';
import { MOCK_INSIGHTS } from '../lib/mockData';
import MarketLensDashboard from '../MarketLensDashboard';

const USE_MOCK = false;

function mapDirectionForUi(d: Insight['direction']): 'bullish' | 'bearish' | 'mixed' | 'neutral' {
  return d === 'unclear' ? 'neutral' : d;
}

function mapHorizonForUi(h: Insight['time_horizon']): 'immediate' | 'short' | 'medium' | 'long' {
  if (h === 'days') return 'immediate';
  if (h === 'weeks') return 'short';
  if (h === 'months') return 'medium';
  return 'long';
}

function convictionPct(c: Insight['conviction']) {
  // DB uses 1–5; UI prototype used 0–100
  return Math.round((c / 5) * 100);
}

export default function Dashboard() {
  const [insights, setInsights] = useState<Insight[]>([]);

  useEffect(() => {
    if (USE_MOCK) {
      setInsights(MOCK_INSIGHTS);
      return;
    }

    supabase
      .from('insights')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) {
          // Fall back to mocks if DB is not wired yet
          console.error('Supabase error:', error);
          setInsights(MOCK_INSIGHTS);
          return;
        }
        setInsights((data as any as Insight[]) ?? []);
      });
  }, []);

  // Transform to the UI prototype's expected shape
  const uiInsights = useMemo(() => {
    return insights.map((i) => ({
      ...i,
      // prototype-only fields
      question: 'What’s the trade / thesis here?',
      story_count: i.story_ids?.length ?? 0,
      views: 0,
      direction: mapDirectionForUi(i.direction),
      time_horizon: mapHorizonForUi(i.time_horizon),
      conviction: convictionPct(i.conviction),
      second_order: i.second_order ?? [],
    }));
  }, [insights]);

  return <MarketLensDashboard __OVERRIDE_INSIGHTS={uiInsights} />;
}

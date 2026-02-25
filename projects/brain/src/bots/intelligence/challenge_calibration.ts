import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

function firstDayOfMonth(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return x.toISOString().slice(0, 10);
}

export async function aggregateMonthlyChallengeCalibration(params?: { reportMonth?: string }): Promise<{
  ok: boolean;
  report_month: string;
  rows_written: number;
  desks: string[];
  warning?: string;
}> {
  const report_month = params?.reportMonth ?? firstDayOfMonth(new Date());

  // Pull all strategy outcomes with a dominant regime; use stored per-strategy calibration score.
  let data: any[] | null = null;
  try {
    const q = await supabaseAdmin
      .from('strategy_outcomes')
      .select('desk,dominant_regime,challenge_calibration_score')
      .not('desk', 'is', null)
      .not('dominant_regime', 'is', null)
      .limit(10000);
    if (q.error) throw q.error;
    data = (q.data ?? []) as any;
  } catch (e: any) {
    // Dev environments may be behind migrations; don't crash the loop.
    const msg = String(e?.message ?? e);
    console.warn('[CALIBRATION] aggregation skipped:', msg);
    return { ok: false, report_month, rows_written: 0, desks: [], warning: msg };
  }

  const rows = (data ?? []) as any[];

  const byDeskRegime = new Map<string, { desk: string; regime: string; scores: number[]; n_total: number }>();
  for (const r of rows) {
    const desk = String(r.desk ?? 'unknown');
    const regime = String(r.dominant_regime ?? 'unknown');
    const key = `${desk}::${regime}`;
    const cur = byDeskRegime.get(key) ?? { desk, regime, scores: [], n_total: 0 };
    cur.n_total += 1;
    const s = Number(r.challenge_calibration_score);
    if (Number.isFinite(s)) cur.scores.push(s);
    byDeskRegime.set(key, cur);
  }

  const upserts: any[] = [];
  const perDeskSummary = new Map<string, any>();

  for (const g of byDeskRegime.values()) {
    const n_strategies = g.n_total;

    let mean_brier_score: number | null = null;
    if (n_strategies < 10) {
      console.log(`[CALIBRATION] insufficient data: month=${report_month} desk=${g.desk} regime=${g.regime} strategies=${n_strategies} (<10) — writing null`);
    } else {
      const scores = g.scores;
      if (scores.length) mean_brier_score = scores.reduce((a, b) => a + b, 0) / scores.length;
      else mean_brier_score = null;
    }

    upserts.push({
      report_month,
      desk: g.desk,
      regime: g.regime,
      n_strategies,
      mean_brier_score,
    });

    const deskSum = perDeskSummary.get(g.desk) ?? { report_month, desk: g.desk, by_regime: {} as any };
    deskSum.by_regime[g.regime] = { n_strategies, mean_brier_score };
    perDeskSummary.set(g.desk, deskSum);
  }

  if (upserts.length) {
    const { error: uErr } = await supabaseAdmin
      .from('challenge_calibration_reports')
      .upsert(upserts, { onConflict: 'report_month,desk,regime' });
    if (uErr) throw uErr;
  }

  // Emit one semantic fact per desk so CoS can pick it up without new wiring.
  for (const deskSum of perDeskSummary.values()) {
    const fact = JSON.stringify({
      type: 'challenge_calibration_monthly',
      ...deskSum,
      metric: 'brier_score',
      interpretation: 'Lower is better. 0=perfect calibration, 1=worst.',
      min_n_strategies_per_desk_regime: 10,
      generated_at: new Date().toISOString(),
    });

    const { error: fErr } = await supabaseAdmin.from('semantic_facts').insert({
      domain: 'challenge_calibration',
      fact,
      fact_type: 'success_pattern',
      confidence: 0.8,
      supporting_episode_ids: [],
      times_confirmed: 1,
      times_violated: 0,
      status: 'active',
    });
    if (fErr) throw fErr;
  }

  return { ok: true, report_month, rows_written: upserts.length, desks: Array.from(perDeskSummary.keys()) };
}

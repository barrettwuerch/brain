import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { getActiveWatchConditions, updateAfterTrigger, expireStaleConditions } from '../../db/watch_conditions';
import { shouldFire } from './condition_evaluator';
import { fetchMetricValue } from './metric_fetcher';

async function getVolRegimeFallback(): Promise<string> {
  // Authoritative regime_state is published by Risk Bot.
  // Expect format: "current_vol_regime={regime} desk=crypto as_of={ISO}"
  try {
    const { data } = await supabaseAdmin
      .from('operational_state')
      .select('value,expires_at')
      .eq('domain', 'regime_state')
      .eq('key', 'vol_regime')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (!data) {
      console.log('[SCANNER] WARNING: No fresh regime_state from Risk Bot — defaulting to normal');
      return 'normal';
    }

    const v: any = (data as any).value ?? {};
    const r = String(v.vol_regime ?? 'normal').toLowerCase();
    if (!['low', 'normal', 'elevated', 'extreme'].includes(r)) return 'normal';
    return r;
  } catch {
    console.log('[SCANNER] WARNING: No fresh regime_state from Risk Bot — defaulting to normal');
    return 'normal';
  }
}

async function gate0MarketDataFreshness(conditions: any[]): Promise<{ ok: boolean; reason?: string }> {
  // Gate 0: freshness check
  // IMPORTANT: reads market data timestamp, NOT task creation time.

  const now = Date.now();

  const hasCrypto = (conditions ?? []).some((c: any) => String(c.market_type ?? '') === 'crypto');
  const hasPrediction = (conditions ?? []).some((c: any) => String(c.market_type ?? '') !== 'crypto');

  // ── Crypto (Alpaca): bar.t freshness, threshold 5 minutes ────────────────
  if (hasCrypto) {
    try {
      const url = new URL('https://data.alpaca.markets/v1beta3/crypto/us/bars');
      url.searchParams.set('symbols', 'BTC/USD');
      url.searchParams.set('timeframe', '1Min');
      url.searchParams.set('limit', '10');
      // Request a narrow window so the returned bar.t reflects *recent* market data.
      url.searchParams.set('start', new Date(Date.now() - 10 * 60 * 1000).toISOString());
      url.searchParams.set('end', new Date().toISOString());

      const resp = await fetch(url.toString());
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`alpaca bars fetch failed ${resp.status}: ${raw.slice(0, 200)}`);
      const j = JSON.parse(raw);
      const arr = (j?.bars?.['BTC/USD'] ?? []) as any[];
      const b = arr.length ? arr[arr.length - 1] : null;
      const ts = String(b?.t ?? b?.timestamp ?? '');
      const t = ts ? new Date(ts).getTime() : NaN;
      const ageMin = (now - t) / (1000 * 60);

      if (!Number.isFinite(ageMin)) {
        const reason = `Gate 0 blocked: Alpaca bar.t missing/invalid (threshold: 5 min)`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      if (ageMin > 5) {
        const reason = `Gate 0 blocked: Alpaca bar.t=${new Date(t).toISOString()} is ${Math.round(ageMin)} min old (threshold: 5 min)`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      console.log(`[SCANNER] Gate 0 passed: Alpaca bar.t=${new Date(t).toISOString()} age=${ageMin.toFixed(2)} min (threshold: 5 min)`);
    } catch (e: any) {
      const reason = `Gate 0 blocked: Alpaca freshness check failed (${e?.message ?? e})`;
      console.log(`[SCANNER] ${reason}`);
      return { ok: false, reason };
    }
  }

  // ── Prediction (Kalshi): market.updated_time + volume_24h > 0, threshold 15 minutes ──
  if (hasPrediction) {
    // Choose a representative ticker from active conditions (if any)
    const ticker = String((conditions ?? []).find((c: any) => String(c.market_type ?? '') !== 'crypto')?.ticker ?? '');

    if (!ticker) {
      const reason = `Gate 0 blocked: Kalshi freshness check missing market ticker (threshold: 15 min)`;
      console.log(`[SCANNER] ${reason}`);
      return { ok: false, reason };
    }

    try {
      const base = 'https://api.elections.kalshi.com/trade-api/v2';
      const url = new URL(base + `/markets/${encodeURIComponent(ticker)}`);

      const resp = await fetch(url.toString());
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`kalshi market fetch failed ${resp.status}: ${raw.slice(0, 200)}`);
      const j = JSON.parse(raw);
      const m = (j?.market ?? j) as any;

      const updated = String(m?.updated_time ?? '');
      const t = updated ? new Date(updated).getTime() : NaN;
      const ageMin = (now - t) / (1000 * 60);
      const vol24 = Number(m?.volume_24h ?? 0);

      if (!Number.isFinite(ageMin)) {
        const reason = `Gate 0 blocked: Kalshi market.updated_time missing/invalid (threshold: 15 min)`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      if (!(vol24 > 0)) {
        const reason = `Gate 0 blocked: Kalshi market.updated_time=${new Date(t).toISOString()} but volume_24h=${vol24} (threshold: 15 min)`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      if (ageMin > 15) {
        const reason = `Gate 0 blocked: Kalshi market.updated_time=${new Date(t).toISOString()} is ${Math.round(ageMin)} min old (threshold: 15 min)`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      console.log(
        `[SCANNER] Gate 0 passed: Kalshi market.updated_time=${new Date(t).toISOString()} age=${ageMin.toFixed(2)} min, volume_24h=${vol24} (threshold: 15 min)`,
      );
    } catch (e: any) {
      const reason = `Gate 0 blocked: Kalshi freshness check failed (${e?.message ?? e})`;
      console.log(`[SCANNER] ${reason}`);
      return { ok: false, reason };
    }
  }

  return { ok: true };
}

export async function runScannerCycle(): Promise<{ conditionsChecked: number; fired: number; tasksCreated: number }> {
  const expired = await expireStaleConditions();
  if (expired) console.log('[SCANNER] expired conditions:', expired);

  const conditions = await getActiveWatchConditions();

  // FIX 6: Gate 0 freshness check — blocks before any strategy evaluation attempt.
  const gate0 = await gate0MarketDataFreshness(conditions as any);
  if (!gate0.ok) {
    // Explicitly return before we fetch any metrics or evaluate any conditions.
    return { conditionsChecked: conditions.length, fired: 0, tasksCreated: 0 };
  }

  const volRegime = await getVolRegimeFallback();

  let fired = 0;
  let tasksCreated = 0;

  for (const c of conditions) {
    const { current, previous } = await fetchMetricValue(c);
    const result = shouldFire(c, current, previous, volRegime);

    console.log(`[SCANNER] ${c.ticker} ${c.metric}=${current} fired=${result.fire} reason=${result.reason}`);

    if (!result.fire) continue;

    if (c.action_type === 'place_limit_order') {
      const taskType = c.market_type === 'crypto' ? 'place_limit_order' : 'place_kalshi_order';
      const desk = c.market_type === 'crypto' ? 'crypto_markets' : 'prediction_markets';

      const { error } = await supabaseAdmin.from('tasks').insert({
        task_type: taskType,
        task_input: {
          ...c.action_params,
          ticker: c.ticker,
          market_type: c.market_type,
          triggered_by_condition: c.id,
        },
        status: 'queued',
        tags: ['scanner'],
        bot_id: c.bot_id,
        agent_role: 'execution',
        desk,
      });
      if (error) throw error;
      tasksCreated++;
    } else {
      console.log(`[SCANNER ALERT] ${c.ticker} ${c.metric} ${c.operator} ${c.value} — condition ${c.id}`);
    }

    await updateAfterTrigger(c.id);
    fired++;
  }

  return { conditionsChecked: conditions.length, fired, tasksCreated };
}

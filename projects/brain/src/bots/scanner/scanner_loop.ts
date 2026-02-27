import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function logGateBlock(
  gate: 'gate_0' | 'gate_1' | 'gate_2' | 'gate_3',
  ticker: string,
  reason: string,
  extras: { edge?: number; score?: number } = {},
) {
  try {
    await supabaseAdmin.from('scanner_gate_events').insert({
      gate,
      ticker,
      reason,
      edge: extras.edge ?? null,
      score: extras.score ?? null,
    } as any);
  } catch {
    // never throw from logging
  }
}
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
  const hasPrediction = (conditions ?? []).some((c: any) => String(c.market_type ?? '') === 'prediction');

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
    const ticker = String((conditions ?? []).find((c: any) => String(c.market_type ?? '') === 'prediction')?.ticker ?? '');

    if (!ticker) {
      const reason = `Gate 0 blocked: Kalshi freshness check missing market ticker (threshold: 15 min)`;
      console.log(`[SCANNER] ${reason}`);
      return { ok: false, reason };
    }

    try {
      // Use the authenticated Kalshi client base URL so demo/prod is consistent.
      const { getMarket } = await import('../../lib/kalshi');
      const m: any = await getMarket(ticker);

      // Demo market payload does not include updated_time/volume_24h reliably.
      // Use close_time freshness and basic bid/ask existence instead.
      const close = String(m?.close_time ?? '');
      const t = close ? new Date(close).getTime() : NaN;
      const ageMin = (now - t) / (1000 * 60);
      const vol = Number(m?.volume ?? 0);
      const yesBid = Number(m?.yes_bid ?? 0);
      const yesAsk = Number(m?.yes_ask ?? 0);

      if (!Number.isFinite(ageMin)) {
        const reason = `Gate 0 blocked: Kalshi market.close_time missing/invalid (threshold: 24h)`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      // Consider the data "fresh" if the market is actively trading (bid/ask present) OR has nonzero volume.
      const hasLiquidity = (yesAsk > 0 && yesAsk <= 100) || (yesBid > 0 && yesBid <= 100) || vol > 0;
      if (!hasLiquidity) {
        const reason = `Gate 0 blocked: Kalshi market has no liquidity signals (yes_bid=${yesBid}, yes_ask=${yesAsk}, volume=${vol})`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      // close_time in the past is expected for settled markets; block if close is >24h old.
      if (ageMin > 24 * 60) {
        const reason = `Gate 0 blocked: Kalshi market.close_time=${new Date(t).toISOString()} is ${Math.round(ageMin)} min old (threshold: 1440 min)`;
        console.log(`[SCANNER] ${reason}`);
        return { ok: false, reason };
      }

      console.log(
        `[SCANNER] Gate 0 passed: Kalshi market.close_time=${new Date(t).toISOString()} age=${ageMin.toFixed(2)} min, yes_bid=${yesBid}, yes_ask=${yesAsk}, volume=${vol}`,
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

    if (c.action_type === 'size_position') {
      console.log('[SCANNER] action=size_position branch taken for condition', c.id);

      // NOTE: drawdownPct must be fetched at *fire time* from bot_states.
      // Do not cache bot_state at cycle start; drawdown needs to reflect current risk posture.
      const { getAccount } = await import('../../lib/alpaca');

      // Cache equity once per scanner cycle.
      // Simulation safety: cap deployable equity to simulation_capital_alpaca.
      const account = await getAccount();
      const equityRaw = Number(account.equity);
      const { capAlpacaDeployableEquity } = await import('../../lib/simulation_capital');
      const equity = await capAlpacaDeployableEquity(equityRaw);

      // Fetch current state + drawdown for the target execution bot.
      // Gate 2 requirement: do NOT seed new position sizing tasks while the bot is PAUSED/DIAGNOSTIC.
      const { data: bs, error: bsErr } = await supabaseAdmin
        .from('bot_states')
        .select('current_state,current_drawdown')
        .eq('bot_id', String(c.bot_id))
        .maybeSingle();
      if (bsErr) throw bsErr;

      const curState = String((bs as any)?.current_state ?? 'exploiting');
      if (curState === 'paused' || curState === 'diagnostic') {
        console.log(`[SCANNER] Skipping seed for bot_id=${c.bot_id} because current_state=${curState}`);
        continue;
      }

      const dd = Number((bs as any)?.current_drawdown ?? 0);

      const BASE_POSITION_FRACTION = 0.02; // TODO: replace with edge.confidence when available
      const baseKellySize = equity * BASE_POSITION_FRACTION;

      const { error } = await supabaseAdmin.from('tasks').insert({
        task_type: 'size_position',
        task_input: {
          ...(c.action_params ?? {}),
          drawdownPct: dd,
          baseKellySize,
        },
        status: 'queued',
        tags: ['scanner', 'risk'],
        bot_id: 'risk-bot-1',
        agent_role: 'risk',
        desk: c.market_type === 'crypto' ? 'crypto_markets' : 'prediction_markets',
      });
      if (error) throw error;
      tasksCreated++;
    } else if (c.action_type === 'place_limit_order') {
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

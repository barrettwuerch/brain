import 'dotenv/config';
import { supabaseAdmin } from '../../lib/supabase';
import { getActiveWatchConditions, updateAfterTrigger, expireStaleConditions } from '../../db/watch_conditions';
import { shouldFire } from './condition_evaluator';
import { fetchMetricValue } from './metric_fetcher';

// ─── Logging ────────────────────────────────────────────────────────────────

async function logGateBlock(
  gate: 'gate_0' | 'gate_1' | 'gate_2' | 'gate_3',
  ticker: string,
  reason: string,
  extras: { edge?: number; score?: number } = {},
) {
  try {
    await supabaseAdmin.from('scanner_gate_events').insert({
      gate, ticker, reason,
      edge: extras.edge ?? null,
      score: extras.score ?? null,
    } as any);
  } catch { /* never throw from logging */ }
}

// ─── Regime ─────────────────────────────────────────────────────────────────

async function getVolRegimeFallback(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('operational_state')
      .select('value,expires_at')
      .eq('domain', 'regime_state')
      .eq('key', 'vol_regime')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!data) return 'normal';
    const r = String((data as any).value?.vol_regime ?? 'normal').toLowerCase();
    return ['low', 'normal', 'elevated', 'extreme'].includes(r) ? r : 'normal';
  } catch {
    return 'normal';
  }
}

// ─── Gate 0: per-condition freshness check ───────────────────────────────────
// Called once per condition so a stale Kalshi market doesn't block crypto.

async function gate0Check(c: any): Promise<{ ok: boolean; reason?: string }> {
  const now = Date.now();
  const ticker = String(c.ticker ?? '');
  const marketType = String(c.market_type ?? '');

  // Skip unsupported market types entirely
  if (marketType === 'equity') {
    return { ok: false, reason: `Gate 0 blocked: equity market type not supported (${ticker})` };
  }

  // ── Crypto: Alpaca bar freshness, threshold 5 min ──────────────────────────
  if (marketType === 'crypto') {
    try {
      const symbol = ticker.replace('/', '%2F');
      const url = new URL(`https://data.alpaca.markets/v1beta3/crypto/us/bars`);
      url.searchParams.set('symbols', ticker);
      url.searchParams.set('timeframe', '1Min');
      url.searchParams.set('limit', '5');
      url.searchParams.set('start', new Date(Date.now() - 10 * 60 * 1000).toISOString());
      url.searchParams.set('end', new Date().toISOString());

      const resp = await fetch(url.toString(), {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
        },
      });
      if (!resp.ok) throw new Error(`Alpaca ${resp.status}`);
      const j = await resp.json();
      const arr = (j?.bars?.[ticker] ?? []) as any[];
      const bar = arr.length ? arr[arr.length - 1] : null;
      const ts = String(bar?.t ?? '');
      const t = ts ? new Date(ts).getTime() : NaN;
      const ageMin = (now - t) / 60000;

      if (!Number.isFinite(ageMin) || ageMin > 10) {
        const reason = `Gate 0 blocked: ${ticker} bar age=${Number.isFinite(ageMin) ? Math.round(ageMin) + 'min' : 'unknown'} (threshold: 5min)`;
        console.log(`[SCANNER] ${reason}`);
        await logGateBlock('gate_0', ticker, reason);
        return { ok: false, reason };
      }

      console.log(`[SCANNER] Gate 0 passed: ${ticker} bar age=${ageMin.toFixed(1)}min`);
      return { ok: true };
    } catch (e: any) {
      const reason = `Gate 0 blocked: ${ticker} Alpaca check failed (${e?.message})`;
      console.log(`[SCANNER] ${reason}`);
      await logGateBlock('gate_0', ticker, reason);
      return { ok: false, reason };
    }
  }

  // ── Prediction: Kalshi market freshness ────────────────────────────────────
  if (marketType === 'prediction') {
    try {
      const { getMarket } = await import('../../lib/kalshi');
      const m: any = await getMarket(ticker);

      const close = String(m?.close_time ?? '');
      const t = close ? new Date(close).getTime() : NaN;
      const ageMin = (now - t) / 60000;
      const yesBid = Number(m?.yes_bid ?? 0);
      const yesAsk = Number(m?.yes_ask ?? 0);
      const vol = Number(m?.volume ?? 0);
      const hasLiquidity = (yesAsk > 0 && yesAsk <= 100) || (yesBid > 0 && yesBid <= 100) || vol > 0;

      if (!Number.isFinite(ageMin)) {
        const reason = `Gate 0 blocked: ${ticker} close_time missing`;
        await logGateBlock('gate_0', ticker, reason);
        return { ok: false, reason };
      }
      if (ageMin > 24 * 60) {
        const reason = `Gate 0 blocked: ${ticker} market settled ${Math.round(ageMin / 60)}h ago`;
        console.log(`[SCANNER] ${reason}`);
        await logGateBlock('gate_0', ticker, reason);
        // Auto-expire stale prediction conditions
        await supabaseAdmin.from('watch_conditions').update({ status: 'expired' }).eq('id', c.id);
        console.log(`[SCANNER] Auto-expired condition ${c.id} (${ticker})`);
        return { ok: false, reason };
      }
      if (!hasLiquidity) {
        const reason = `Gate 0 blocked: ${ticker} no liquidity (bid=${yesBid} ask=${yesAsk} vol=${vol})`;
        await logGateBlock('gate_0', ticker, reason);
        return { ok: false, reason };
      }

      console.log(`[SCANNER] Gate 0 passed: ${ticker} age=${ageMin.toFixed(0)}min bid=${yesBid} ask=${yesAsk}`);
      return { ok: true };
    } catch (e: any) {
      const reason = `Gate 0 blocked: ${ticker} Kalshi check failed (${e?.message})`;
      await logGateBlock('gate_0', ticker, reason);
      return { ok: false, reason };
    }
  }

  return { ok: false, reason: `Gate 0 blocked: unknown market_type=${marketType}` };
}

// ─── Live price fetch for crypto limit orders ────────────────────────────────

async function getLivePrice(ticker: string): Promise<number | null> {
  try {
    const url = new URL('https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes');
    url.searchParams.set('symbols', ticker);
    const resp = await fetch(url.toString(), {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
      },
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const q = j?.quotes?.[ticker];
    // Use midpoint of bid/ask
    const bid = Number(q?.bp ?? 0);
    const ask = Number(q?.ap ?? 0);
    if (bid > 0 && ask > 0) return (bid + ask) / 2;
    return null;
  } catch {
    return null;
  }
}

// ─── Main scanner cycle ──────────────────────────────────────────────────────

export async function runScannerCycle(): Promise<{ conditionsChecked: number; fired: number; tasksCreated: number }> {
  const expired = await expireStaleConditions();
  if (expired) console.log(`[SCANNER] Expired ${expired} stale conditions`);

  const conditions = await getActiveWatchConditions();
  console.log(`[SCANNER] Checking ${conditions.length} active conditions`);

  const volRegime = await getVolRegimeFallback();
  console.log(`[SCANNER] Vol regime: ${volRegime}`);

  let fired = 0;
  let tasksCreated = 0;

  for (const c of conditions) {
    const ticker = String(c.ticker ?? '');

    // Gate 0: per-condition freshness (replaces global check)
    const g0 = await gate0Check(c);
    if (!g0.ok) continue;

    // Vol regime gate
    if (c.vol_regime_gate && c.vol_regime_gate !== volRegime) {
      console.log(`[SCANNER] ${ticker} skipped — vol_regime_gate=${c.vol_regime_gate} current=${volRegime}`);
      continue;
    }

    // Fetch metric and evaluate condition
    const { current, previous } = await fetchMetricValue(c);
    const result = shouldFire(c, current, previous, volRegime);
    console.log(`[SCANNER] ${ticker} metric=${c.metric} current=${current} fired=${result.fire} reason=${result.reason}`);

    if (!result.fire) continue;

    // ── size_position ────────────────────────────────────────────────────────
    if (c.action_type === 'size_position') {
      const { getAccount } = await import('../../lib/alpaca');
      const account = await getAccount();
      const equityRaw = Number(account.equity);
      const { capAlpacaDeployableEquity } = await import('../../lib/simulation_capital');
      const equity = await capAlpacaDeployableEquity(equityRaw);

      const { data: bs } = await supabaseAdmin
        .from('bot_states')
        .select('current_state,current_drawdown')
        .eq('bot_id', String(c.bot_id))
        .maybeSingle();

      const curState = String((bs as any)?.current_state ?? 'exploiting').toLowerCase();
      if (curState === 'paused' || curState === 'diagnostic') {
        console.log(`[SCANNER] Skipping — bot ${c.bot_id} is ${curState}`);
        continue;
      }

      const dd = Number((bs as any)?.current_drawdown ?? 0);
      if (dd > 0.15) {
        const reason = `Gate 3 blocked: drawdown=${dd.toFixed(2)} > 0.15`;
        console.log(`[SCANNER] ${reason}`);
        await logGateBlock('gate_3', ticker, reason);
        continue;
      }

      const BASE_POSITION_FRACTION = 0.02;
      const baseKellySize = equity * BASE_POSITION_FRACTION;

      const { error } = await supabaseAdmin.from('tasks').insert({
        task_type: 'size_position',
        task_input: {
          ...(c.action_params ?? {}),
          ticker,
          market_type: c.market_type,
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
      console.log(`[SCANNER] Created size_position task for ${ticker} baseKelly=$${baseKellySize.toFixed(2)}`);
      tasksCreated++;
    }

    // ── place_limit_order / place_kalshi_order ───────────────────────────────
    else if (c.action_type === 'place_limit_order') {
      const taskType = c.market_type === 'crypto' ? 'place_limit_order' : 'place_kalshi_order';
      const desk = c.market_type === 'crypto' ? 'crypto_markets' : 'prediction_markets';

      // For crypto: fetch live price if useMarketPrice or limitPrice is null/1
      let actionParams = { ...(c.action_params ?? {}), ticker, market_type: c.market_type };
      if (c.market_type === 'crypto') {
        const livePrice = await getLivePrice(ticker);
        if (livePrice) {
          // Use 0.1% below mid as limit price (maker order)
          actionParams.limitPrice = parseFloat((livePrice * 0.999).toFixed(2));
          console.log(`[SCANNER] ${ticker} live mid=$${livePrice.toFixed(2)} limit=$${actionParams.limitPrice}`);
        } else {
          console.log(`[SCANNER] ${ticker} could not fetch live price — skipping`);
          continue;
        }
      }

      const { error } = await supabaseAdmin.from('tasks').insert({
        task_type: taskType,
        task_input: {
          ...actionParams,
          triggered_by_condition: c.id,
        },
        status: 'queued',
        tags: ['scanner'],
        bot_id: c.bot_id,
        agent_role: 'execution',
        desk,
      });
      if (error) throw error;
      console.log(`[SCANNER] Created ${taskType} task for ${ticker}`);
      tasksCreated++;
    }

    // ── alert_only ───────────────────────────────────────────────────────────
    else {
      console.log(`[SCANNER ALERT] ${ticker} ${c.metric} ${c.operator} ${c.value} — condition ${c.id}`);
    }

    await updateAfterTrigger(c.id);
    fired++;
  }

  console.log(`[SCANNER] Cycle complete — checked=${conditions.length} fired=${fired} tasks=${tasksCreated}`);
  return { conditionsChecked: conditions.length, fired, tasksCreated };
}

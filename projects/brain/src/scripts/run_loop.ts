// Phase 3 runner: pull tasks until queue empty, run full loop, sleep between.

import 'dotenv/config';

import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';
import { runScannerCycle } from '../bots/scanner/scanner_loop'
import { getLatestQuote } from '../lib/alpaca'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchNextQueued() {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function main() {
  const loop = new BrainLoop();
  let n = 0;
  let lastHeartbeatAt = 0;
  let lastScannerAt = 0
  let lastPositionCheckAt = 0;
  let lastStuckTaskCheckAt = 0;
  let lastCapitalSyncAt = 0;
  let lastCosReviewAt = 0;
  let lastMcScanAt = 0;

  console.log('[LOOP] Starting Brain loop with scanner integration');

  while (true) {
    const now = Date.now();
    // ── Stuck task watchdog: every 5 min ──────────────────────────────────────
    if (now - lastStuckTaskCheckAt > 5 * 60 * 1000) {
      lastStuckTaskCheckAt = now;
      try {
        const stuckCutoff = new Date(now - 5 * 60 * 1000).toISOString();
        const { data: stuck } = await supabaseAdmin.from('tasks').select('id,task_type').eq('status', 'running').lt('updated_at', stuckCutoff);
        if (stuck && stuck.length > 0) {
          const ids = stuck.map((t: any) => t.id);
          await supabaseAdmin.from('tasks').update({ status: 'queued' }).in('id', ids);
          console.log(`[WATCHDOG] Reset ${stuck.length} stuck tasks:`, stuck.map((t: any) => t.task_type).join(', '));
        }
      } catch (e: any) { console.error('[WATCHDOG] Error:', e?.message); }
    }

    // ── Position manager: every 30 min ────────────────────────────────────────
    if (now - lastPositionCheckAt > 10 * 60 * 1000) {
      lastPositionCheckAt = now;
      try {
        const { data: openPos } = await supabaseAdmin.from('positions').select('*').is('closed_at', null).eq('desk', 'crypto_markets');
        for (const pos of openPos ?? []) {
          const p = pos as any;
          let currentPrice = Number(p.entry_price);
          try { const rawTicker = String(p.market_ticker); const ticker = rawTicker.includes("/") ? rawTicker : rawTicker.replace(/USD$/, "/USD"); const q = await getLatestQuote(ticker); currentPrice = (q.bid + q.ask) / 2; } catch (e: any) { console.warn(`[LOOP] Quote failed for ${p.market_ticker}:`, e?.message); }
          const entryPrice = Number(p.entry_price);
          const peakPrice = Number(p.peak_price ?? entryPrice);
          const unrealizedPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          const daysHeld = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24);
          const pctFromPeak = ((currentPrice - peakPrice) / peakPrice) * 100;
          const distToStop = ((currentPrice - Number(p.stop_level)) / currentPrice) * 100;
          const distToTarget = ((Number(p.profit_target) - currentPrice) / currentPrice) * 100;

          // Trailing stop: ratchet up as position gains
          let dynamicStop = Number(p.stop_level);
          if (unrealizedPct > 8) dynamicStop = Math.max(dynamicStop, entryPrice * 1.04);
          else if (unrealizedPct > 5) dynamicStop = Math.max(dynamicStop, entryPrice * 1.001);

          const exitHint = unrealizedPct < -3 ? 'approaching_stop'
            : unrealizedPct > 7 ? 'near_target'
            : pctFromPeak < -3 ? 'pulling_back_from_peak'
            : 'within_bands';

          await supabaseAdmin.from('tasks').insert({
            task_type: 'manage_crypto_position',
            agent_role: 'execution',
            bot_id: 'crypto-execution-bot-1',
            desk: 'crypto_markets',
            status: 'queued',
            task_input: {
              symbol: p.symbol ?? p.market_ticker,
              market_ticker: p.symbol ?? p.market_ticker,
              market_type: 'crypto',
              current_price: currentPrice,
              max_hold_days: 7,
              order: { market_ticker: p.symbol ?? p.market_ticker, fill_price: entryPrice, side: String(p.side ?? 'buy') },
              stop_level: dynamicStop,
              profit_target: Number(p.profit_target),
              finding_id: p.finding_id ?? null,
              position_id: p.id,
              context: {
                days_held: parseFloat(daysHeld.toFixed(2)),
                unrealized_pct: parseFloat(unrealizedPct.toFixed(2)),
                peak_price: peakPrice,
                pct_from_peak: parseFloat(pctFromPeak.toFixed(2)),
                dist_to_stop_pct: parseFloat(distToStop.toFixed(2)),
                dist_to_target_pct: parseFloat(distToTarget.toFixed(2)),
                trailing_stop_updated: dynamicStop > Number(p.stop_level),
                hard_stop: Number(p.stop_level),
                dynamic_stop: dynamicStop,
                exit_hint: exitHint,
              },
            },
          } as any);
          console.log(`[LOOP] Position check queued: ${p.market_ticker} cur=${currentPrice.toFixed(2)} unrealized=${unrealizedPct.toFixed(2)}% hint=${exitHint}`);
        }
      } catch (e: any) { console.error('[LOOP] Position manager error:', e?.message); }
    }

    // ── Scanner: run every 60 seconds ──────────────────────────────────────

    if (now - lastScannerAt > 60 * 1000) {
      lastScannerAt = now;
      try {
        console.log('[LOOP] Running scanner cycle...');
        const result = await runScannerCycle();
        console.log(`[LOOP] Scanner done — checked=${result.conditionsChecked} fired=${result.fired} tasks=${result.tasksCreated}`);
      } catch (e: any) {
        console.error('[LOOP] Scanner cycle failed:', e?.message ?? e);
      }
    }

    // ── Heartbeat: every 5 minutes ──────────────────────────────────────────
    if (now - lastHeartbeatAt > 5 * 60 * 1000) {
      lastHeartbeatAt = now;
      try {
        await supabaseAdmin.from('episodes').insert({
          task_id: null,
          task_type: 'loop_heartbeat',
          task_input: { source: 'run_loop' },
          agent_role: 'orchestrator',
          desk: 'general',
          bot_id: 'orchestrator-1',
          reasoning: 'Loop heartbeat',
          action_taken: { ok: true },
          observation: { ok: true },
          reflection: null,
          lessons: [],
          outcome: 'success',
          outcome_score: 1,
          reasoning_score: 1,
          error_type: null,
          ttl_days: 1,
          embedding: null,
          vol_regime: 'normal',
        } as any);
      } catch (e: any) {
        console.warn('[LOOP] Heartbeat insert failed:', e?.message ?? e);
      }
    }

    // -- Monte Carlo BTC mispricing scan: every 30 min
    if (now - lastMcScanAt > 30 * 60 * 1000) {
      lastMcScanAt = now;
      try {
        const { seedBtcMispricingScan } = await import('../adapters/kalshi/research_tasks');
        await seedBtcMispricingScan();
      } catch (e: any) { console.error('[MC] Scan error:', e?.message); }
    }

    // -- CoS system review: every 4 hours
    if (now - lastCosReviewAt > 4 * 60 * 60 * 1000) {
      lastCosReviewAt = now;
      try {
        await supabaseAdmin.from('tasks').insert({
          task_type: 'cos_system_review',
          agent_role: 'chief_of_staff',
          bot_id: 'cos-bot-1',
          desk: 'all_desks',
          status: 'queued',
          task_input: { source: 'scheduler', triggered_at: new Date().toISOString() },
          tags: ['cos', 'scheduled'],
        } as any);
        console.log('[COS] Queued cos_system_review');
      } catch (e: any) { console.error('[COS] Failed to queue review:', e?.message); }
    }

        // ── Capital sync: every 15 min ────────────────────────────────────────
    if (now - lastCapitalSyncAt > 15 * 60 * 1000) {
      lastCapitalSyncAt = now;
      try {
        const { getAccount } = await import('../lib/alpaca');
        const account = await getAccount();
        const currentEquity = Number(account.equity);
        const startingEquity = 100000; // Alpaca paper starting equity
        const startingCap = 40000;     // Our sim cap at launch
        const newCap = Math.round((currentEquity / startingEquity) * startingCap);
        await supabaseAdmin
          .from('operational_state')
          .update({ value: { amount: newCap } })
          .eq('domain', 'simulation')
          .eq('key', 'simulation_capital_alpaca');
        console.log(`[CAPITAL] Synced sim cap: $${newCap} (equity=$${currentEquity.toFixed(2)})`);
      } catch (e: any) { console.error('[CAPITAL] Sync error:', e?.message); }
    }

    // ── Task processing ─────────────────────────────────────────────────────
    const task = await fetchNextQueued();
    if (!task) {
      if (n % 12 === 0) console.log('[LOOP] Queue empty. Waiting...');
      n++;
      await sleep(5000);
      continue;
    }

    // Reset counter when tasks are flowing
    n = 0;

    // Claim task
    await supabaseAdmin.from('tasks').update({ status: 'running' }).eq('id', task.id);

    try {
      const out = await loop.run(task);

      if ('aborted' in out) {
        console.log(`[LOOP] task=${task.task_type} ABORTED reason=${out.reason}`);
      } else {
        console.log(
          `[LOOP] task=${task.task_type} outcome=${out.episode.outcome} score=${out.episode.outcome_score} episode=${out.store.episode_id}`,
        );
        if (String(process.env.BRAIN_DEBUG_REASONING || '').toLowerCase() === 'true') {
          console.log('reasoning:', out.episode.reasoning);
        }
      }
    } catch (e: any) {
      console.error('[LOOP] Task failed:', task.id, e?.message ?? e);
      await supabaseAdmin.from('tasks').update({ status: 'failed' }).eq('id', task.id);
    }

    await sleep(2000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import fs from 'node:fs';

const LOOP = `${process.env.HOME}/.openclaw/workspace/projects/brain/src/agent/loop.ts`;
const RUN_LOOP = `${process.env.HOME}/.openclaw/workspace/projects/brain/src/scripts/run_loop.ts`;
const FLOW = `${process.env.HOME}/.openclaw/workspace/projects/brain/src/scripts/fix_crypto_flow.ts`;

let loop = fs.readFileSync(LOOP, 'utf8');
let runLoop = fs.readFileSync(RUN_LOOP, 'utf8');

// ── Fix 1: Write position row after Alpaca order placed ──────────
loop = loop.replace(
  `      return {
        action_taken: {
          ...action_taken,
          order: {
            order_id: order.id,
            client_order_id: order.client_order_id,
            approved_qty: Math.floor(qty),
            status: order.status,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            time_in_force: order.time_in_force,
            limit_price: order.limit_price ?? null,
          },
        },
        result: { placed: true, order_id: order.id, client_order_id: order.client_order_id, approved_qty: Math.floor(qty) },
        outcome_score: undefined,
      };`,
  `      // Write position row so manage_crypto_position can track it
      if (isCrypto) {
        try {
          const { openPosition } = await import('../db/positions');
          const stopLevel = limitPrice * (side === 'buy' ? 0.95 : 1.05);   // -5% stop
          const profitTarget = limitPrice * (side === 'buy' ? 1.10 : 0.90); // +10% target
          await openPosition({
            bot_id: String(args.task.bot_id ?? 'crypto-execution-bot-1'),
            desk: 'crypto_markets',
            market_ticker: symbol,
            symbol,
            side: side as any,
            entry_price: limitPrice,
            remaining_size: parseFloat(orderQty),
            contracts: parseFloat(orderQty),
            stop_level: stopLevel,
            profit_target: profitTarget,
            alpaca_order_id: order.id,
            status: 'open',
          } as any);
          console.log(\`[EXECUTION] Position opened: \${symbol} entry=\${limitPrice} stop=\${stopLevel.toFixed(2)} target=\${profitTarget.toFixed(2)}\`);
        } catch (e: any) {
          console.error('[EXECUTION] Failed to write position row:', e?.message);
        }
      }

      return {
        action_taken: {
          ...action_taken,
          order: {
            order_id: order.id,
            client_order_id: order.client_order_id,
            approved_qty: Math.floor(qty),
            status: order.status,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            time_in_force: order.time_in_force,
            limit_price: order.limit_price ?? null,
          },
        },
        result: { placed: true, order_id: order.id, client_order_id: order.client_order_id, approved_qty: Math.floor(qty) },
        outcome_score: undefined,
      };`
);

// ── Fix 2: Add position manager to run_loop ──────────────────────
runLoop = runLoop.replace(
  `import { runScannerCycle } from '../bots/scanner/scanner_loop'`,
  `import { runScannerCycle } from '../bots/scanner/scanner_loop'
import { supabaseAdmin } from '../lib/supabase'
import { getLatestQuote } from '../lib/alpaca'`
);

runLoop = runLoop.replace(
  `  let lastScannerAt = 0`,
  `  let lastScannerAt = 0
  let lastPositionCheckAt = 0`
);

runLoop = runLoop.replace(
  `    // Scanner cycle`,
  `    // Position manager — every 30 min create manage_crypto_position tasks
    if (now - lastPositionCheckAt > 30 * 60 * 1000) {
      lastPositionCheckAt = now;
      try {
        const { data: openPos } = await supabaseAdmin
          .from('positions')
          .select('*')
          .is('closed_at', null)
          .eq('desk', 'crypto_markets');
        for (const pos of openPos ?? []) {
          const p = pos as any;
          let currentPrice = Number(p.entry_price);
          try {
            const q = await getLatestQuote(String(p.symbol ?? p.market_ticker));
            currentPrice = (q.bid + q.ask) / 2;
          } catch {}
          await supabaseAdmin.from('tasks').insert({
            task_type: 'manage_crypto_position',
            agent_role: 'execution',
            bot_id: 'crypto-execution-bot-1',
            desk: 'crypto_markets',
            status: 'pending',
            task_input: {
              symbol: p.symbol ?? p.market_ticker,
              market_ticker: p.symbol ?? p.market_ticker,
              market_type: 'crypto',
              current_price: currentPrice,
              max_hold_days: 7,
              order: {
                market_ticker: p.symbol ?? p.market_ticker,
                fill_price: Number(p.entry_price),
                side: String(p.side ?? 'buy'),
              },
              stop_level: Number(p.stop_level),
              profit_target: Number(p.profit_target),
              position_id: p.id,
            },
          });
          console.log(\`[LOOP] Position check queued: \${p.symbol} cur=\${currentPrice.toFixed(2)} stop=\${Number(p.stop_level).toFixed(2)} target=\${Number(p.profit_target).toFixed(2)}\`);
        }
      } catch (e: any) {
        console.error('[LOOP] Position manager error:', e?.message);
      }
    }

    // Scanner cycle`
);

fs.writeFileSync(LOOP, loop);
fs.writeFileSync(RUN_LOOP, runLoop);

console.log('loop.ts patched:', loop.includes('Position opened') ? '✅ Fix 1: position row on entry' : '❌ Fix 1 MISSING');
console.log('run_loop.ts patched:', runLoop.includes('Position manager') ? '✅ Fix 2: position manager poller' : '❌ Fix 2 MISSING');

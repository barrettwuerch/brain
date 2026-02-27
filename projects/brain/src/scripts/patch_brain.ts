import fs from 'node:fs';
import path from 'node:path';

const LOOP_PATH = path.join(process.env.HOME!, '.openclaw/workspace/projects/brain/src/agent/loop.ts');

let src = fs.readFileSync(LOOP_PATH, 'utf8');
const orig = src;

// Fix 1: continuation guard — remove limitPrice requirement
src = src.replace(
  `if (!task_type || !bot_id || !task_input?.symbol || !task_input?.side || !task_input?.limitPrice) {`,
  `if (!task_type || !bot_id || !task_input?.symbol || !task_input?.side) {`
);

// Fix 2: live price fetch + fractional qty for crypto
src = src.replace(
  `      const limitPrice = Number(tInput.limitPrice ?? tInput.limit_price);
      if (!Number.isFinite(limitPrice) || limitPrice <= 0) return earlyExit('missing_limit_price');

      const side = String(tInput.side ?? '').toLowerCase();
      if (side !== 'buy' && side !== 'sell') return earlyExit('invalid_side', { side });

      const order = await alpacaPlaceOrder({
        symbol,
        qty: String(Math.floor(qty)),
        side: side as any,
        type: 'limit',
        time_in_force: 'gtc',
        limit_price: String(limitPrice),
        client_order_id: String(args.task.id),
      });`,
  `      let limitPrice = Number(tInput.limitPrice ?? tInput.limit_price);
      const isCrypto = String(tInput.market_type ?? '').toLowerCase() === 'crypto';

      if (isCrypto && (tInput.useMarketPrice || !Number.isFinite(limitPrice) || limitPrice <= 0)) {
        try {
          const { getLatestQuote } = await import('../lib/alpaca');
          const q = await getLatestQuote(symbol);
          limitPrice = parseFloat(((q.bid + q.ask) / 2 * 0.999).toFixed(2));
          console.log(\`[EXECUTION] Live price for \${symbol}: bid=\${q.bid} ask=\${q.ask} limit=\${limitPrice}\`);
        } catch (e: any) {
          return earlyExit('live_price_fetch_failed', { error: e?.message });
        }
      }

      if (!Number.isFinite(limitPrice) || limitPrice <= 0) return earlyExit('missing_limit_price');

      const side = String(tInput.side ?? '').toLowerCase();
      if (side !== 'buy' && side !== 'sell') return earlyExit('invalid_side', { side });

      const orderQty = isCrypto
        ? String(Math.max(0.0001, parseFloat((qty / limitPrice).toFixed(4))))
        : String(Math.floor(qty));

      console.log(\`[EXECUTION] \${symbol} isCrypto=\${isCrypto} approvedSize=\$\${qty.toFixed(2)} limitPrice=\${limitPrice} qty=\${orderQty}\`);

      const order = await alpacaPlaceOrder({
        symbol,
        qty: orderQty,
        side: side as any,
        type: 'limit',
        time_in_force: 'gtc',
        limit_price: String(limitPrice),
        client_order_id: String(args.task.id),
      });`
);

// Fix 3: tighter knowledge library budget for execution tasks
src = src.replace(
  `      let klText = lines.join('\\n');
      // Enforce a budget for knowledge injection.
      while (estimateTokens(klText) > 1200) {`,
  `      let klText = lines.join('\\n');
      const klBudget = ['place_limit_order', 'place_kalshi_order', 'manage_open_position', 'size_position'].includes(String(input.task.task_type)) ? 400 : 1200;
      while (estimateTokens(klText) > klBudget) {`
);

if (src === orig) {
  console.error('ERROR: No replacements made — strings may have changed.');
  process.exit(1);
}

fs.writeFileSync(LOOP_PATH, src);
console.log('loop.ts patched successfully');
console.log(src.includes('if (!task_type || !bot_id || !task_input?.symbol || !task_input?.side) {') ? '✅ Fix 1: continuation guard' : '❌ Fix 1 MISSING');
console.log(src.includes('Live price for') ? '✅ Fix 2: live price + fractional qty' : '❌ Fix 2 MISSING');
console.log(src.includes('klBudget') ? '✅ Fix 3: knowledge library budget' : '❌ Fix 3 MISSING');

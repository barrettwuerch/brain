import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: conditions, error } = await sb
    .from('watch_conditions')
    .select('*')
    .eq('status', 'active')
    .order('created_at');

  if (error) throw error;
  console.log(`Found ${conditions?.length ?? 0} active conditions`);
  console.log(JSON.stringify(conditions, null, 2));

  for (const c of conditions ?? []) {
    if (c.action_type !== 'alert_only') {
      console.log(`[SKIP] ${c.ticker} already has action_type=${c.action_type}`);
      continue;
    }

    const newActionType = c.market_type === 'crypto' ? 'size_position' : 'place_limit_order';
    const newBotId = c.market_type === 'crypto' ? 'risk-bot-1' : 'execution-bot-1';

    const actionParams = c.market_type === 'crypto'
      ? { symbol: c.ticker, market_type: 'crypto', side: 'buy', strategy: 'momentum' }
      : { ticker: c.ticker, market_type: 'prediction', side: 'yes', contracts: 10, limit_price: 0.52 };

    const { error: updErr } = await sb
      .from('watch_conditions')
      .update({
        action_type: newActionType,
        bot_id: newBotId,
        action_params: actionParams,
        max_triggers_per_day: 2,
      })
      .eq('id', c.id);

    if (updErr) {
      console.error(`[ERROR] Failed to upgrade ${c.ticker}:`, updErr.message);
    } else {
      console.log(`[UPGRADED] ${c.ticker} ${c.market_type} → action_type=${newActionType} bot=${newBotId}`);
    }
  }

  const { data: after } = await sb
    .from('watch_conditions')
    .select('ticker,market_type,action_type,bot_id,status')
    .eq('status', 'active');
  console.log('\n--- After upgrade ---');
  console.log(JSON.stringify(after, null, 2));
}

run().catch(console.error);

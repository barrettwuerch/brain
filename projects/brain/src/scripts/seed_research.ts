import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const tasks = [
    {
      task_type: 'generate_next_generation_hypothesis',
      task_input: { context: 'crypto_markets', tickers: ['BTC/USD','ETH/USD','SOL/USD'], goal: 'identify volume and momentum entry signals with positive expectancy' },
      agent_role: 'research',
      bot_id: 'research-bot-1',
      desk: 'crypto_markets',
      tags: ['research', 'hypothesis', 'crypto'],
    },
    {
      task_type: 'funding_rate_scan',
      task_input: { tickers: ['BTC/USD','ETH/USD','SOL/USD'] },
      agent_role: 'research',
      bot_id: 'research-bot-1',
      desk: 'crypto_markets',
      tags: ['research', 'funding_rate'],
    },
    {
      task_type: 'volatility_regime_detect',
      task_input: { tickers: ['BTC/USD','ETH/USD','SOL/USD'] },
      agent_role: 'research',
      bot_id: 'research-bot-1',
      desk: 'crypto_markets',
      tags: ['research', 'vol_regime'],
    },
    {
      task_type: 'correlation_scan',
      task_input: { pairs: [['BTC/USD','ETH/USD'],['BTC/USD','SOL/USD'],['ETH/USD','SOL/USD']] },
      agent_role: 'research',
      bot_id: 'research-bot-1',
      desk: 'crypto_markets',
      tags: ['research', 'correlation'],
    },
  ].map(t => ({ ...t, status: 'queued' }));

  const { error } = await supabaseAdmin.from('tasks').insert(tasks as any);
  if (error) throw error;
  console.log('Seeded', tasks.length, 'research tasks');
}

main().catch(e => { console.error(e); process.exit(1); });

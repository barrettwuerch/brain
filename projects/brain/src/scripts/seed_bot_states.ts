import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function run() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const bots = [
    { bot_id: 'crypto-execution-bot-1', agent_role: 'execution', desk: 'crypto_markets' },
    { bot_id: 'crypto-research-bot-1',  agent_role: 'research',  desk: 'crypto_markets' },
    { bot_id: 'crypto-strategy-bot-1',  agent_role: 'strategy',  desk: 'crypto_markets' },
  ];
  for (const { bot_id, agent_role, desk } of bots) {
    const { error } = await sb.from('bot_states').upsert({
      bot_id, agent_role, desk,
      current_state: 'exploiting',
      current_drawdown: 0,
      reason: 'initialized',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'bot_id' });
    console.log(error ? `ERROR ${bot_id}: ${error.message}` : `OK ${bot_id}`);
  }
}

run().catch(console.error);

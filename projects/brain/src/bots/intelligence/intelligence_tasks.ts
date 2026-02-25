import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['intelligence'],
    agent_role: 'intelligence',
    desk: 'general',
    bot_id: 'intelligence-bot-1',
  });
  if (error) throw error;
}

async function nextRoleToReview(): Promise<'research' | 'strategy' | 'risk' | 'execution'> {
  const order: Array<'research' | 'strategy' | 'risk' | 'execution'> = ['research', 'strategy', 'risk', 'execution'];

  const { data } = await supabaseAdmin
    .from('episodes')
    .select('task_input,created_at')
    .eq('task_type', 'propose_skill_update')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const last = data ? String((data as any).task_input?.target_role ?? '') : '';
  const idx = order.indexOf(last as any);
  const next = order[(idx + 1) % order.length];
  return next;
}

function skillPathFor(role: string): string {
  const upper = String(role).toUpperCase();
  return `skills/${upper}_BOT_SKILL.md`;
}

async function main() {
  const mode = String(process.argv[2] ?? '').trim();

  if (mode === 'skill_update') {
    const target_role = await nextRoleToReview();
    await insertTask('propose_skill_update', {
      target_role,
      skill_file: skillPathFor(target_role),
      min_confidence_threshold: 0.75,
      min_facts_required: 5,
    });
    console.log('Seeded propose_skill_update task.', { target_role });
    return;
  }

  await insertTask('consolidate_memories', {});
  await insertTask('attribute_performance', {});
  console.log('Seeded intelligence tasks.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

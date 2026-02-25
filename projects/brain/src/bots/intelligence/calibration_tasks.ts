import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';

export async function seedMonthlyChallengeCalibrationTask(reportMonth?: string): Promise<void> {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type: 'aggregate_challenge_calibration',
    task_input: {
      report_month: reportMonth ?? null,
    },
    status: 'queued',
    tags: ['intelligence', 'monthly', 'calibration'],
    agent_role: 'intelligence',
    desk: 'all_desks',
    bot_id: 'intelligence-bot-1',
  });
  if (error) throw error;
  console.log('[Intelligence] Seeded: aggregate_challenge_calibration');
}

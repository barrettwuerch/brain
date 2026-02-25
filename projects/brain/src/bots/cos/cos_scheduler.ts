// src/bots/cos/cos_scheduler.ts
//
// Cron expressions and scheduling logic for Chief of Staff Bot tasks.
// Wire into main app scheduler via registerCosSchedules(cron).
//
// All times CST (UTC-6). Adjust for CDT (UTC-5) during daylight saving.
//
// Schedule:
// generate_daily_brief 6:45 AM CST daily
// assess_strategic_priorities 5:00 PM CST Sunday
// generate_weekly_memo 5:45 PM CST Sunday
// review_regime_strategy_alignment 7:00 AM CST Monday
// detect_systematic_blind_spots 5:00 PM CST first Sunday of month
//
// Event-triggered (seeded by Orchestrator, not scheduler):
// generate_decision_packet
// evaluate_bottlenecks

import {
  seedBlindSpotReviewTask,
  seedDailyBriefTask,
  seedRegimeAlignmentTask,
  seedStrategicPrioritiesTask,
  seedWeeklyMemoTask,
} from './cos_tasks';

import { seedMonthlyChallengeCalibrationTask } from '../intelligence/calibration_tasks';

export const COS_CRON_SCHEDULES = {
  daily_brief: '45 12 * * *', // 6:45 AM CST = 12:45 UTC
  strategic_priorities: '0 23 * * 0', // 5:00 PM CST Sunday = 23:00 UTC
  weekly_memo: '45 23 * * 0', // 5:45 PM CST Sunday = 23:45 UTC
  regime_alignment: '0 13 * * 1', // 7:00 AM CST Monday = 13:00 UTC
  blind_spots: '0 23 1-7 * 0', // weekly, handler gates to first Sunday
  challenge_calibration: '15 23 1-7 * 0', // monthly (first Sunday), 5:15 PM CST
} as const;

export function registerCosSchedules(cron: any): void {
  cron.schedule(
    COS_CRON_SCHEDULES.daily_brief,
    async () => {
      try {
        await seedDailyBriefTask();
      } catch (e: any) {
        console.error(`[CoS Scheduler] daily brief seed failed: ${e.message}`);
      }
    },
    { timezone: 'America/Chicago' },
  );

  cron.schedule(
    COS_CRON_SCHEDULES.strategic_priorities,
    async () => {
      try {
        await seedStrategicPrioritiesTask();
      } catch (e: any) {
        console.error(`[CoS Scheduler] priorities seed failed: ${e.message}`);
      }
    },
    { timezone: 'America/Chicago' },
  );

  cron.schedule(
    COS_CRON_SCHEDULES.weekly_memo,
    async () => {
      try {
        await seedWeeklyMemoTask();
      } catch (e: any) {
        console.error(`[CoS Scheduler] weekly memo seed failed: ${e.message}`);
      }
    },
    { timezone: 'America/Chicago' },
  );

  cron.schedule(
    COS_CRON_SCHEDULES.regime_alignment,
    async () => {
      try {
        await seedRegimeAlignmentTask('normal', 0);
      } catch (e: any) {
        console.error(`[CoS Scheduler] regime alignment seed failed: ${e.message}`);
      }
    },
    { timezone: 'America/Chicago' },
  );

  cron.schedule(
    COS_CRON_SCHEDULES.blind_spots,
    async () => {
      if (!isFirstSundayOfMonth()) return;
      try {
        await seedBlindSpotReviewTask();
      } catch (e: any) {
        console.error(`[CoS Scheduler] blind spots seed failed: ${e.message}`);
      }
    },
    { timezone: 'America/Chicago' },
  );

  // FIX 5: monthly calibration aggregation task (Intelligence role)
  cron.schedule(
    COS_CRON_SCHEDULES.challenge_calibration,
    async () => {
      if (!isFirstSundayOfMonth()) return;
      try {
        await seedMonthlyChallengeCalibrationTask();
      } catch (e: any) {
        console.error(`[CoS Scheduler] challenge calibration seed failed: ${e.message}`);
      }
    },
    { timezone: 'America/Chicago' },
  );

  console.log('[CoS Scheduler] All CoS schedules registered.');
}

function isFirstSundayOfMonth(): boolean {
  const now = new Date();
  return now.getDay() === 0 && now.getDate() <= 7;
}

// src/scheduler.ts
//
// Brain-owned cron scheduler.
//
// This is intentionally a lightweight skeleton.
// The Brain should own its own cron schedules rather than relying on OpenClaw.
//
// Currently wired:
// - Chief of Staff schedules (CoS)
//
// Note: Intelligence nightly already runs via scripts (see src/scripts/nightly_intelligence.ts
// invoked by npm run dev:nightly). Do not duplicate that schedule here yet.

import cron from 'node-cron';

import { registerCosSchedules } from './bots/cos/cos_scheduler';

export function registerAllSchedules() {
  registerCosSchedules(cron);

  // TODO: If/when we want the Brain process to run nightly intelligence automatically,
  // wire it here, but do NOT duplicate existing external scheduling behavior.
  // Existing entry point: src/scripts/nightly_intelligence.ts (npm run dev:nightly)

  console.log('[scheduler] schedules registered');
}

// CLI: tsx src/scheduler.ts
if (process.argv[1]?.endsWith('scheduler.ts')) {
  registerAllSchedules();
}

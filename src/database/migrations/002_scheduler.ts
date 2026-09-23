import type { Migration } from '../MigrationRunner.js';

/**
 * Adds scheduler execution-tracking columns to the `jobs` table.
 *
 * The base `jobs` table (created in 001_initial) stores the schedule spec in
 * `schedule` (JSON) and the task payload in `payload` (JSON). This migration
 * adds the runtime state needed for a persistent, restart-safe scheduler.
 */
export const migration: Migration = {
  name: '002_scheduler',
  up: `
    ALTER TABLE jobs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE jobs ADD COLUMN next_run_at TEXT;
    ALTER TABLE jobs ADD COLUMN last_run_at TEXT;
    ALTER TABLE jobs ADD COLUMN last_result TEXT;
    ALTER TABLE jobs ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(enabled, status, next_run_at);
  `,
};

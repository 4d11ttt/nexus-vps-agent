import type { Logger } from 'pino';
import type { AuditService } from '../audit/AuditService.js';
import type { Config } from '../config.js';
import type { Database } from '../database/Database.js';
import type { Job } from '../database/types.js';
import {
  jobPayloadSchema,
  jobScheduleSchema,
  type JobPayload,
  type JobSchedule,
  type ScheduledTaskRunner,
  type SchedulerNotifier,
} from './types.js';

export interface SchedulerDeps {
  db: Database;
  config: Config;
  logger: Logger;
  runner: ScheduledTaskRunner;
  notifier?: SchedulerNotifier;
  audit?: AuditService;
}

export interface CreateJobInput {
  name: string;
  schedule: JobSchedule;
  instruction: string;
  notify?: boolean;
}

/**
 * Persistent, in-process scheduler.
 *
 * Jobs are stored in the SQLite `jobs` table and survive process restarts. A
 * polling timer picks up due jobs, claims them atomically (preventing duplicate
 * execution), runs their natural-language instruction through AgentCore, and
 * persists the outcome. Optional Telegram delivery is handled through the
 * injected notifier.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private stopped = false;
  private ticking = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.deps.logger.info(
      { intervalMs: this.deps.config.SCHEDULER_POLL_INTERVAL_MS },
      'Scheduler started',
    );
    void this.tick();
    this.timer = setInterval(
      () => void this.tick(),
      this.deps.config.SCHEDULER_POLL_INTERVAL_MS,
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.deps.logger.info('Scheduler stopped');
  }

  /** Perform a single poll for due jobs. Public for tests. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const now = new Date().toISOString();
      const due = this.deps.db.repositories.jobs.findDue(now);
      for (const job of due) {
        await this.execute(job, now);
      }
    } catch (error) {
      this.deps.logger.error({ error }, 'Scheduler tick failed');
    } finally {
      this.ticking = false;
    }
  }

  createJob(userId: number, input: CreateJobInput): Job {
    const payload: JobPayload = {
      instruction: input.instruction,
      notify: input.notify ?? false,
    };
    const schedule = input.schedule;

    const job = this.deps.db.repositories.jobs.create({
      user_id: userId,
      name: input.name,
      schedule: JSON.stringify(schedule),
      payload: JSON.stringify(payload),
      status: 'pending',
      enabled: 1,
      next_run_at: this.computeInitialNextRun(schedule),
    });

    this.deps.audit?.record({
      userId,
      eventType: 'scheduler_create',
      metadata: { jobId: job.id, name: job.name },
    });

    return job;
  }

  listJobs(userId: number): Job[] {
    return this.deps.db.repositories.jobs.findByUserId(userId);
  }

  cancelJob(userId: number, id: number): boolean {
    const job = this.deps.db.repositories.jobs.findById(id);
    if (!job || job.user_id !== userId) return false;
    const cancelled = this.deps.db.repositories.jobs.cancel(id);

    if (cancelled) {
      this.deps.audit?.record({
        userId,
        eventType: 'scheduler_cancel',
        metadata: { jobId: id },
      });
    }
    return cancelled;
  }

  private computeInitialNextRun(schedule: JobSchedule): string {
    if (schedule.type === 'once') return schedule.at;
    // Interval jobs run once immediately, then every intervalMs thereafter.
    return new Date().toISOString();
  }

  private async execute(job: Job, now: string): Promise<void> {
    const claimed = this.deps.db.repositories.jobs.claim(job.id, now);
    if (!claimed) return;

    this.deps.logger.info({ jobId: job.id, name: job.name }, 'Executing scheduled job');
    try {
      const payload = this.parsePayload(job.payload);
      const schedule = this.parseSchedule(job.schedule);

      const result = await this.deps.runner.run({
        userId: job.user_id,
        message: payload.instruction,
      });

      const nextRunAt =
        schedule.type === 'interval'
          ? new Date(Date.now() + schedule.intervalMs).toISOString()
          : null;
      const status = schedule.type === 'interval' ? 'active' : 'completed';
      const enabled = schedule.type === 'interval' ? 1 : 0;

      this.deps.db.repositories.jobs.completeRun(job.id, {
        status,
        lastResult: result.response,
        nextRunAt,
        enabled,
      });

      if (payload.notify) {
        await this.notify(job.user_id, result.response);
      }

      this.deps.logger.info(
        { jobId: job.id, status },
        'Scheduled job completed',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ jobId: job.id, error }, 'Scheduled job failed');
      this.deps.db.repositories.jobs.markFailed(job.id, message);
    }
  }

  private async notify(userId: number, text: string): Promise<void> {
    if (!this.deps.notifier) return;
    const user = this.deps.db.repositories.users.findById(userId);
    if (!user) return;
    const telegramUserId = Number(user.telegram_user_id);
    if (!Number.isInteger(telegramUserId)) return;

    try {
      await this.deps.notifier.notify(telegramUserId, text);
    } catch (error) {
      this.deps.logger.error({ error }, 'Scheduled job notification failed');
    }
  }

  private parseSchedule(raw: string | null): JobSchedule {
    if (!raw) throw new Error('Job is missing a schedule');
    return jobScheduleSchema.parse(JSON.parse(raw));
  }

  private parsePayload(raw: string): JobPayload {
    return jobPayloadSchema.parse(JSON.parse(raw || '{}'));
  }
}

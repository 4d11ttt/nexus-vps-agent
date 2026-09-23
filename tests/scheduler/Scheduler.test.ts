import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { Scheduler } from '../../src/scheduler/Scheduler.js';
import { createTestDatabase } from '../database/helpers.js';
import { loadConfig } from '../../src/config.js';
import type { Database } from '../../src/database/Database.js';
import type { Config } from '../../src/config.js';

function makeConfig(): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SCHEDULER_POLL_INTERVAL_MS: '1000',
  });
}

describe('Scheduler', () => {
  let db: Database;
  let cleanup: () => void;
  let config: Config;
  let runner: { run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    config = makeConfig();
    runner = { run: vi.fn(async () => ({ response: 'ok', finishReason: 'completed' })) };
  });

  afterEach(() => {
    cleanup();
  });

  it('creates a one-time job with a due next_run_at', () => {
    const scheduler = new Scheduler({ db, config, logger: pino({ level: 'silent' }), runner });
    const user = db.repositories.users.create({ telegram_user_id: 's1', status: 'active' });

    const job = scheduler.createJob(user.id, {
      name: 'once',
      instruction: 'check nginx',
      schedule: { type: 'once', at: '2000-01-01T00:00:00.000Z' },
    });

    expect(job.status).toBe('pending');
    expect(job.next_run_at).toBe('2000-01-01T00:00:00.000Z');
    expect(job.enabled).toBe(1);
  });

  it('executes a due job once and marks it completed', async () => {
    const scheduler = new Scheduler({ db, config, logger: pino({ level: 'silent' }), runner });
    const user = db.repositories.users.create({ telegram_user_id: 's2', status: 'active' });
    const job = scheduler.createJob(user.id, {
      name: 'once',
      instruction: 'check nginx',
      schedule: { type: 'once', at: '2000-01-01T00:00:00.000Z' },
    });

    await scheduler.tick();

    expect(runner.run).toHaveBeenCalledWith({ userId: user.id, message: 'check nginx' });

    const after = db.repositories.jobs.findById(job.id)!;
    expect(after.status).toBe('completed');
    expect(after.run_count).toBe(1);
    expect(after.enabled).toBe(0);
  });

  it('does not execute a completed job again', async () => {
    const scheduler = new Scheduler({ db, config, logger: pino({ level: 'silent' }), runner });
    const user = db.repositories.users.create({ telegram_user_id: 's3', status: 'active' });
    scheduler.createJob(user.id, {
      name: 'once',
      instruction: 'check nginx',
      schedule: { type: 'once', at: '2000-01-01T00:00:00.000Z' },
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('notifies the authorized user when requested', async () => {
    const notifier = { notify: vi.fn(async () => {}) };
    const scheduler = new Scheduler({
      db,
      config,
      logger: pino({ level: 'silent' }),
      runner,
      notifier,
    });
    const user = db.repositories.users.create({ telegram_user_id: '12345', status: 'active' });
    scheduler.createJob(user.id, {
      name: 'notify',
      instruction: 'report status',
      schedule: { type: 'once', at: '2000-01-01T00:00:00.000Z' },
      notify: true,
    });

    await scheduler.tick();

    expect(notifier.notify).toHaveBeenCalledWith(12345, 'ok');
  });

  it('marks a failed job without throwing', async () => {
    const failingRunner = {
      run: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const scheduler = new Scheduler({
      db,
      config,
      logger: pino({ level: 'silent' }),
      runner: failingRunner,
    });
    const user = db.repositories.users.create({ telegram_user_id: 's4', status: 'active' });
    const job = scheduler.createJob(user.id, {
      name: 'fail',
      instruction: 'do something',
      schedule: { type: 'once', at: '2000-01-01T00:00:00.000Z' },
    });

    await scheduler.tick();

    const after = db.repositories.jobs.findById(job.id)!;
    expect(after.status).toBe('failed');
    expect(after.last_result).toContain('boom');
  });

  it('cancels a job owned by the user only', () => {
    const scheduler = new Scheduler({ db, config, logger: pino({ level: 'silent' }), runner });
    const userA = db.repositories.users.create({ telegram_user_id: 'sa', status: 'active' });
    const userB = db.repositories.users.create({ telegram_user_id: 'sb', status: 'active' });
    const job = scheduler.createJob(userA.id, {
      name: 'x',
      instruction: 'do',
      schedule: { type: 'once', at: '2000-01-01T00:00:00.000Z' },
    });

    expect(scheduler.cancelJob(userB.id, job.id)).toBe(false);
    expect(scheduler.cancelJob(userA.id, job.id)).toBe(true);

    const after = db.repositories.jobs.findById(job.id)!;
    expect(after.status).toBe('cancelled');
    expect(after.enabled).toBe(0);
  });
});

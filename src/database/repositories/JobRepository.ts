import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { Job, JobCreate, JobUpdate } from '../types.js';

export class JobRepository extends BaseRepository {
  create(data: JobCreate): Job {
    const result = this.db
      .prepare(
        `INSERT INTO jobs (user_id, name, schedule, payload, status, enabled, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.user_id,
        data.name,
        data.schedule ?? null,
        data.payload ?? '{}',
        data.status ?? 'pending',
        data.enabled ?? 1,
        data.next_run_at ?? null,
      );

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): Job | undefined {
    return cleanRow<Job>(
      this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id),
    );
  }

  findByUserId(userId: number): Job[] {
    return cleanRows<Job>(
      this.db
        .prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId),
    );
  }

  findAll(): Job[] {
    return cleanRows<Job>(this.db.prepare('SELECT * FROM jobs').all());
  }

  /**
   * Return enabled jobs that are due for execution at or before `now`.
   */
  findDue(now: string): Job[] {
    return cleanRows<Job>(
      this.db
        .prepare(
          `SELECT * FROM jobs
           WHERE enabled = 1
             AND status IN ('active', 'pending')
             AND (next_run_at IS NULL OR next_run_at <= ?)
           ORDER BY next_run_at ASC`,
        )
        .all(now),
    );
  }

  /**
   * Atomically claim a job for execution, preventing duplicate runs from
   * concurrent scheduler ticks. Returns true when the claim succeeded.
   */
  claim(id: number, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'running', last_run_at = ?, updated_at = datetime('now')
         WHERE id = ? AND enabled = 1 AND status != 'running'`,
      )
      .run(now, id);
    return result.changes > 0;
  }

  /**
   * Record a completed execution, advancing the run counter and scheduling the
   * next run (or marking one-time jobs as finished).
   */
  completeRun(
    id: number,
    data: { status: string; lastResult: string; nextRunAt: string | null; enabled?: number },
  ): Job | undefined {
    this.db
      .prepare(
        `UPDATE jobs
         SET status = ?, last_result = ?, next_run_at = ?, enabled = ?,
             run_count = run_count + 1, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(data.status, data.lastResult, data.nextRunAt, data.enabled ?? 1, id);

    return this.findById(id);
  }

  /**
   * Mark a job as failed without crashing the scheduler.
   */
  markFailed(id: number, lastResult: string): Job | undefined {
    this.db
      .prepare(
        `UPDATE jobs
         SET status = 'failed', last_result = ?, run_count = run_count + 1,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(lastResult, id);

    return this.findById(id);
  }

  update(id: number, data: JobUpdate): Job | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.schedule !== undefined) {
      fields.push('schedule = ?');
      values.push(data.schedule);
    }
    if (data.payload !== undefined) {
      fields.push('payload = ?');
      values.push(data.payload);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    this.db
      .prepare(
        `UPDATE jobs SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }

  updateStatus(id: number, status: string): Job | undefined {
    return this.update(id, { status });
  }

  cancel(id: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs
         SET enabled = 0, status = 'cancelled', updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(id);
    return result.changes > 0;
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }
}


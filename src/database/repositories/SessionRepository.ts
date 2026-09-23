import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { Session, SessionCreate, SessionUpdate } from '../types.js';

export class SessionRepository extends BaseRepository {
  create(data: SessionCreate): Session {
    const result = this.db
      .prepare(
        `INSERT INTO sessions (user_id, title, status)
         VALUES (?, ?, ?)`,
      )
      .run(data.user_id, data.title ?? null, data.status ?? 'active');

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): Session | undefined {
    return cleanRow<Session>(
      this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id),
    );
  }

  findByUserId(userId: number): Session[] {
    return cleanRows<Session>(
      this.db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    );
  }

  findAll(): Session[] {
    return cleanRows<Session>(this.db.prepare('SELECT * FROM sessions').all());
  }

  update(id: number, data: SessionUpdate): Session | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.title !== undefined) {
      fields.push('title = ?');
      values.push(data.title);
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
        `UPDATE sessions SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

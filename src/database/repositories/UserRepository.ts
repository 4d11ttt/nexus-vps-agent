import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { User, UserCreate, UserUpdate } from '../types.js';

export class UserRepository extends BaseRepository {
  create(data: UserCreate): User {
    const result = this.db
      .prepare(
        `INSERT INTO users (telegram_user_id, username, display_name, language, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        data.telegram_user_id,
        data.username ?? null,
        data.display_name ?? null,
        data.language ?? 'id',
        data.status ?? 'active',
      );

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): User | undefined {
    return cleanRow<User>(
      this.db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    );
  }

  findByTelegramUserId(telegramUserId: string): User | undefined {
    return cleanRow<User>(
      this.db.prepare('SELECT * FROM users WHERE telegram_user_id = ?').get(telegramUserId),
    );
  }

  findAll(): User[] {
    return cleanRows<User>(this.db.prepare('SELECT * FROM users').all());
  }

  update(id: number, data: UserUpdate): User | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.username !== undefined) {
      fields.push('username = ?');
      values.push(data.username);
    }
    if (data.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(data.display_name);
    }
    if (data.language !== undefined) {
      fields.push('language = ?');
      values.push(data.language);
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
        `UPDATE users SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

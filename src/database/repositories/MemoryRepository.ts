import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { Memory, MemoryCreate, MemoryUpdate } from '../types.js';

export class MemoryRepository extends BaseRepository {
  create(data: MemoryCreate): Memory {
    const result = this.db
      .prepare(
        `INSERT INTO memories (user_id, key, content, category, importance)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(data.user_id, data.key, data.content, data.category ?? 'general', data.importance ?? 0);

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): Memory | undefined {
    return cleanRow<Memory>(
      this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id),
    );
  }

  findByUserId(userId: number): Memory[] {
    return cleanRows<Memory>(
      this.db
        .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC')
        .all(userId),
    );
  }

  findByKey(userId: number, key: string): Memory | undefined {
    return cleanRow<Memory>(
      this.db
        .prepare('SELECT * FROM memories WHERE user_id = ? AND key = ?')
        .get(userId, key),
    );
  }

  findAll(): Memory[] {
    return cleanRows<Memory>(this.db.prepare('SELECT * FROM memories').all());
  }

  update(id: number, data: MemoryUpdate): Memory | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.key !== undefined) {
      fields.push('key = ?');
      values.push(data.key);
    }
    if (data.content !== undefined) {
      fields.push('content = ?');
      values.push(data.content);
    }
    if (data.category !== undefined) {
      fields.push('category = ?');
      values.push(data.category);
    }
    if (data.importance !== undefined) {
      fields.push('importance = ?');
      values.push(data.importance);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    this.db
      .prepare(
        `UPDATE memories SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

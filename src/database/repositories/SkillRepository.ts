import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { Skill, SkillCreate, SkillUpdate } from '../types.js';

export class SkillRepository extends BaseRepository {
  create(data: SkillCreate): Skill {
    const result = this.db
      .prepare(
        `INSERT INTO skills (name, path, description, enabled)
         VALUES (?, ?, ?, ?)`,
      )
      .run(data.name, data.path, data.description ?? null, data.enabled ?? 1);

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): Skill | undefined {
    return cleanRow<Skill>(
      this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id),
    );
  }

  findByName(name: string): Skill | undefined {
    return cleanRow<Skill>(
      this.db.prepare('SELECT * FROM skills WHERE name = ?').get(name),
    );
  }

  findAll(): Skill[] {
    return cleanRows<Skill>(this.db.prepare('SELECT * FROM skills').all());
  }

  update(id: number, data: SkillUpdate): Skill | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.path !== undefined) {
      fields.push('path = ?');
      values.push(data.path);
    }
    if (data.description !== undefined) {
      fields.push('description = ?');
      values.push(data.description);
    }
    if (data.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(data.enabled);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    this.db
      .prepare(
        `UPDATE skills SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

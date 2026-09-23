import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { AuditEvent, AuditEventCreate } from '../types.js';

export class AuditEventRepository extends BaseRepository {
  create(data: AuditEventCreate): AuditEvent {
    const result = this.db
      .prepare(
        `INSERT INTO audit_events (user_id, event_type, metadata)
         VALUES (?, ?, ?)`,
      )
      .run(data.user_id ?? null, data.event_type, data.metadata ?? '{}');

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): AuditEvent | undefined {
    return cleanRow<AuditEvent>(
      this.db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id),
    );
  }

  findByUserId(userId: number): AuditEvent[] {
    return cleanRows<AuditEvent>(
      this.db
        .prepare('SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId),
    );
  }

  findAll(): AuditEvent[] {
    return cleanRows<AuditEvent>(
      this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC').all(),
    );
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM audit_events WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

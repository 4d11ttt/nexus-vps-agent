import type { Database } from '../database/Database.js';

/**
 * Security-relevant audit logging.
 *
 * Records events such as unauthorized access, session starts, tool invocations,
 * and scheduler mutations into the existing `audit_events` table. Metadata is
 * kept small and must never contain secrets.
 */
export interface AuditRecord {
  userId?: number | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  constructor(private readonly db: Database) {}

  record(record: AuditRecord): void {
    try {
      this.db.repositories.auditEvents.create({
        user_id: record.userId ?? null,
        event_type: record.eventType,
        metadata: JSON.stringify(record.metadata ?? {}),
      });
    } catch {
      // Audit logging must never break the primary operation.
    }
  }
}

import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { ToolCall, ToolCallCreate } from '../types.js';

export class ToolCallRepository extends BaseRepository {
  create(data: ToolCallCreate): ToolCall {
    const result = this.db
      .prepare(
        `INSERT INTO tool_calls (session_id, tool_name, arguments, result, status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.session_id,
        data.tool_name,
        data.arguments,
        data.result ?? null,
        data.status ?? 'pending',
        data.duration_ms ?? null,
      );

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): ToolCall | undefined {
    return cleanRow<ToolCall>(
      this.db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id),
    );
  }

  findBySessionId(sessionId: number): ToolCall[] {
    return cleanRows<ToolCall>(
      this.db
        .prepare('SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId),
    );
  }

  findAll(): ToolCall[] {
    return cleanRows<ToolCall>(
      this.db.prepare('SELECT * FROM tool_calls ORDER BY created_at ASC').all(),
    );
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM tool_calls WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

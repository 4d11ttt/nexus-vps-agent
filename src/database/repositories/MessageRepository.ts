import { BaseRepository } from './BaseRepository.js';
import { cleanRow, cleanRows } from './helpers.js';
import type { Message, MessageCreate } from '../types.js';

export class MessageRepository extends BaseRepository {
  create(data: MessageCreate): Message {
    const result = this.db
      .prepare(
        `INSERT INTO messages (session_id, role, content)
         VALUES (?, ?, ?)`,
      )
      .run(data.session_id, data.role, data.content);

    return this.findById(Number(result.lastInsertRowid))!;
  }

  findById(id: number): Message | undefined {
    return cleanRow<Message>(
      this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id),
    );
  }

  findBySessionId(sessionId: number): Message[] {
    return cleanRows<Message>(
      this.db
        .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId),
    );
  }

  findAll(): Message[] {
    return cleanRows<Message>(
      this.db.prepare('SELECT * FROM messages ORDER BY created_at ASC').all(),
    );
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

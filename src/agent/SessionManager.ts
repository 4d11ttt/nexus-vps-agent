import type { Database } from '../database/Database.js';
import type { Session, User } from '../database/types.js';

export interface SessionManagerDeps {
  db: Database;
}

export class SessionManager {
  constructor(private readonly deps: SessionManagerDeps) {}

  async getOrCreateSession(input: {
    userId: number;
    sessionId?: number;
    title?: string;
  }): Promise<Session> {
    const { db } = this.deps;

    if (input.sessionId !== undefined) {
      const existing = db.repositories.sessions.findById(input.sessionId);
      if (existing) return existing;
    }

    return db.repositories.sessions.create({
      user_id: input.userId,
      title: input.title ?? 'New session',
      status: 'active',
    });
  }

  async findLatestActiveSession(userId: number): Promise<Session | undefined> {
    return this.deps.db.repositories.sessions
      .findByUserId(userId)
      .find((s) => s.status === 'active');
  }

  async addUserMessage(sessionId: number, content: string): Promise<void> {
    this.deps.db.repositories.messages.create({
      session_id: sessionId,
      role: 'user',
      content,
    });
  }

  async addAssistantMessage(
    sessionId: number,
    content: string,
  ): Promise<void> {
    this.deps.db.repositories.messages.create({
      session_id: sessionId,
      role: 'assistant',
      content,
    });
  }

  async addToolCall(
    sessionId: number,
    toolCall: { id: string; name: string; arguments: string },
    result: { output: string; error?: string; durationMs: number },
  ): Promise<void> {
    this.deps.db.repositories.toolCalls.create({
      session_id: sessionId,
      tool_name: toolCall.name,
      arguments: toolCall.arguments,
      result: result.output,
      status: result.error ? 'error' : 'success',
      duration_ms: result.durationMs,
    });
  }

  async loadMessages(sessionId: number): Promise<
    Array<{ role: string; content: string }>
  > {
    return this.deps.db.repositories.messages.findBySessionId(sessionId).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  async ensureUser(
    telegramUserId: string,
    meta?: { username?: string; displayName?: string },
  ): Promise<User> {
    const existing = this.deps.db.repositories.users.findByTelegramUserId(telegramUserId);
    if (existing) return existing;
    return this.deps.db.repositories.users.create({
      telegram_user_id: telegramUserId,
      username: meta?.username ?? null,
      display_name: meta?.displayName ?? null,
      language: 'id',
      status: 'active',
    });
  }
}

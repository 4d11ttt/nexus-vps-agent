import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/agent/SessionManager.js';
import { createTestDatabase } from '../database/helpers.js';
import type { Database } from '../../src/database/Database.js';
import { resolveAgentUser, resolveSession } from '../../src/telegram/session.js';

describe('Telegram session mapping', () => {
  let db: Database;
  let cleanup: () => void;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    sessionManager = new SessionManager({ db });
  });

  afterEach(() => {
    cleanup();
  });

  it('creates an agent user for a new Telegram user', async () => {
    const user = await resolveAgentUser(12345, 'alice', 'Alice Smith', sessionManager);
    expect(user.telegram_user_id).toBe('12345');
    expect(user.username).toBe('alice');
    expect(user.display_name).toBe('Alice Smith');
  });

  it('reuses an existing agent user for the same Telegram ID', async () => {
    const first = await resolveAgentUser(12345, 'alice', 'Alice', sessionManager);
    const second = await resolveAgentUser(12345, 'alice2', 'Alice 2', sessionManager);
    expect(second.id).toBe(first.id);
  });

  it('creates a session for a new user', async () => {
    const user = await resolveAgentUser(12345, 'alice', 'Alice', sessionManager);
    const session = await resolveSession(user, sessionManager);
    expect(session.user_id).toBe(user.id);
  });

  it('reuses the latest active session for the same user', async () => {
    const user = await resolveAgentUser(12345, 'alice', 'Alice', sessionManager);
    const first = await resolveSession(user, sessionManager);
    const second = await resolveSession(user, sessionManager);
    expect(second.id).toBe(first.id);
  });

  it('creates a new session when the previous one is closed', async () => {
    const user = await resolveAgentUser(12345, 'alice', 'Alice', sessionManager);
    const first = await resolveSession(user, sessionManager);
    db.repositories.sessions.update(first.id, { status: 'closed' });
    const second = await resolveSession(user, sessionManager);
    expect(second.id).not.toBe(first.id);
  });
});


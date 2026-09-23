import { describe, it, expect } from 'vitest';
import { createTestDatabase } from './helpers.js';

describe('Repositories', () => {
  it('users CRUD', () => {
    const { db, cleanup } = createTestDatabase();

    const user = db.repositories.users.create({
      telegram_user_id: 'u123',
      language: 'id',
      status: 'active',
    });
    expect(user.telegram_user_id).toBe('u123');

    const found = db.repositories.users.findByTelegramUserId('u123');
    expect(found).toBeDefined();

    const updated = db.repositories.users.update(user.id, {
      display_name: 'Test User',
    });
    expect(updated?.display_name).toBe('Test User');

    const deleted = db.repositories.users.delete(user.id);
    expect(deleted).toBe(true);
    expect(db.repositories.users.findById(user.id)).toBeUndefined();

    cleanup();
  });

  it('sessions CRUD', () => {
    const { db, cleanup } = createTestDatabase();

    const user = db.repositories.users.create({
      telegram_user_id: 's123',
      language: 'id',
      status: 'active',
    });
    const session = db.repositories.sessions.create({
      user_id: user.id,
      title: 'Test Session',
      status: 'active',
    });
    expect(session.user_id).toBe(user.id);

    const byUser = db.repositories.sessions.findByUserId(user.id);
    expect(byUser.length).toBe(1);

    const updated = db.repositories.sessions.update(session.id, {
      status: 'closed',
    });
    expect(updated?.status).toBe('closed');

    db.repositories.sessions.delete(session.id);
    cleanup();
  });

  it('messages CRUD', () => {
    const { db, cleanup } = createTestDatabase();

    const user = db.repositories.users.create({
      telegram_user_id: 'm123',
      language: 'id',
      status: 'active',
    });
    const session = db.repositories.sessions.create({
      user_id: user.id,
      title: 'Chat',
      status: 'active',
    });
    const message = db.repositories.messages.create({
      session_id: session.id,
      role: 'user',
      content: 'hello',
    });
    expect(message.content).toBe('hello');

    const messages = db.repositories.messages.findBySessionId(session.id);
    expect(messages.length).toBe(1);

    cleanup();
  });

  it('tool call persistence', () => {
    const { db, cleanup } = createTestDatabase();

    const user = db.repositories.users.create({
      telegram_user_id: 't123',
      language: 'id',
      status: 'active',
    });
    const session = db.repositories.sessions.create({
      user_id: user.id,
      title: 'Chat',
      status: 'active',
    });
    const toolCall = db.repositories.toolCalls.create({
      session_id: session.id,
      tool_name: 'shell',
      arguments: '{}',
      result: '{"ok":true}',
      status: 'success',
      duration_ms: 100,
    });
    expect(toolCall.tool_name).toBe('shell');

    const found = db.repositories.toolCalls.findBySessionId(session.id);
    expect(found.length).toBe(1);

    cleanup();
  });

  it('memory persistence', () => {
    const { db, cleanup } = createTestDatabase();

    const user = db.repositories.users.create({
      telegram_user_id: 'mem123',
      language: 'id',
      status: 'active',
    });
    const memory = db.repositories.memories.create({
      user_id: user.id,
      key: 'pref',
      content: 'value',
      category: 'user',
      importance: 5,
    });
    expect(memory.key).toBe('pref');

    const byKey = db.repositories.memories.findByKey(user.id, 'pref');
    expect(byKey).toBeDefined();

    const updated = db.repositories.memories.update(memory.id, {
      content: 'updated',
    });
    expect(updated?.content).toBe('updated');

    cleanup();
  });

  it('skill persistence', () => {
    const { db, cleanup } = createTestDatabase();

    const skill = db.repositories.skills.create({
      name: 'deploy',
      path: 'skills/deploy',
      description: 'Deploy application',
      enabled: 1,
    });
    expect(skill.name).toBe('deploy');

    const found = db.repositories.skills.findByName('deploy');
    expect(found).toBeDefined();

    const updated = db.repositories.skills.update(skill.id, { enabled: 0 });
    expect(updated?.enabled).toBe(0);

    cleanup();
  });

  it('job persistence', () => {
    const { db, cleanup } = createTestDatabase();

    const user = db.repositories.users.create({
      telegram_user_id: 'j123',
      language: 'id',
      status: 'active',
    });
    const job = db.repositories.jobs.create({
      user_id: user.id,
      name: 'backup',
      schedule: '0 0 * * *',
      payload: '{}',
      status: 'pending',
    });
    expect(job.name).toBe('backup');

    const updated = db.repositories.jobs.updateStatus(job.id, 'running');
    expect(updated?.status).toBe('running');

    cleanup();
  });

  it('audit event persistence', () => {
    const { db, cleanup } = createTestDatabase();

    const user = db.repositories.users.create({
      telegram_user_id: 'a123',
      language: 'id',
      status: 'active',
    });
    const event = db.repositories.auditEvents.create({
      user_id: user.id,
      event_type: 'tool_call',
      metadata: '{"tool":"shell"}',
    });
    expect(event.event_type).toBe('tool_call');

    const events = db.repositories.auditEvents.findByUserId(user.id);
    expect(events.length).toBe(1);

    cleanup();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { createMemoryTools } from '../../src/memory/tools.js';
import { createTestDatabase } from '../database/helpers.js';
import { loadConfig } from '../../src/config.js';
import type { Database } from '../../src/database/Database.js';
import type { ToolContext } from '../../src/tools/context.js';

function makeConfig(workspaceDir: string) {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    WORKSPACE_DIR: workspaceDir,
    MEMORY_MAX_RESULTS: '3',
    MEMORY_CONTEXT_LIMIT: '200',
  });
}

function makeCtx(userId: number): ToolContext {
  return {
    logger: pino({ level: 'silent' }),
    config: makeConfig('.'),
    userId,
    sessionId: 1,
  };
}

describe('MemoryManager', () => {
  let db: Database;
  let cleanup: () => void;
  let workspaceDir: string;
  let manager: MemoryManager;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;

    workspaceDir = mkdtempSync(join(tmpdir(), 'nexus-ws-'));
    writeFileSync(join(workspaceDir, 'SOUL.md'), '# SOUL\nIdentity');
    writeFileSync(join(workspaceDir, 'USER.md'), '# USER\nPreferences');
    writeFileSync(join(workspaceDir, 'MEMORY.md'), '# MEMORY\nKnowledge');

    manager = new MemoryManager({
      db,
      config: makeConfig(workspaceDir),
      logger: pino({ level: 'silent' }),
    });
  });

  afterEach(() => {
    cleanup();
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('loads workspace files', () => {
    expect(manager.loadSoul()).toContain('Identity');
    expect(manager.loadUser()).toContain('Preferences');
    expect(manager.loadMemoryFile()).toContain('Knowledge');
  });

  it('saves and updates memory by key', () => {
    const user = db.repositories.users.create({ telegram_user_id: 'u1', status: 'active' });
    const saved = manager.save(user.id, { key: 'pref', content: 'first' });
    expect(saved.key).toBe('pref');

    const updated = manager.save(user.id, { key: 'pref', content: 'second' });
    expect(updated.content).toBe('second');
    expect(updated.id).toBe(saved.id);
  });

  it('searches memory and respects the result limit', () => {
    const user = db.repositories.users.create({ telegram_user_id: 'u2', status: 'active' });
    manager.save(user.id, { key: 'a', content: 'nginx config', importance: 1 });
    manager.save(user.id, { key: 'b', content: 'database notes', importance: 5 });
    manager.save(user.id, { key: 'c', content: 'other', importance: 0 });
    manager.save(user.id, { key: 'd', content: 'nginx logs', importance: 0 });

    const results = manager.search(user.id, 'nginx');
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.every((r) => r.content.toLowerCase().includes('nginx'))).toBe(true);
  });

  it('deletes memory by key', () => {
    const user = db.repositories.users.create({ telegram_user_id: 'u3', status: 'active' });
    manager.save(user.id, { key: 'x', content: 'delete me' });
    expect(manager.deleteByKey(user.id, 'x')).toBe(true);
    expect(manager.deleteByKey(user.id, 'x')).toBe(false);
  });

  it('builds a bounded memory context', () => {
    const user = db.repositories.users.create({ telegram_user_id: 'u4', status: 'active' });
    manager.save(user.id, { key: 'k1', content: 'a'.repeat(500) });
    manager.save(user.id, { key: 'k2', content: 'b'.repeat(500) });

    const ctx = manager.buildMemoryContext(user.id, 'a');
    expect(ctx.length).toBeLessThanOrEqual(500);
  });
});

describe('memory tools', () => {
  it('memory_search and memory_save are scoped to the user', async () => {
    const testDb = createTestDatabase();
    const workspace = mkdtempSync(join(tmpdir(), 'nexus-ws2-'));
    mkdirSync(workspace, { recursive: true });
    const config = makeConfig(workspace);
    const manager = new MemoryManager({ db: testDb.db, config, logger: pino({ level: 'silent' }) });
    const tools = createMemoryTools(manager);
    const user = testDb.db.repositories.users.create({ telegram_user_id: 'tool-u', status: 'active' });

    const saveTool = tools.find((t) => t.name === 'memory_save')!;
    const searchTool = tools.find((t) => t.name === 'memory_search')!;

    const saveResult = await saveTool.execute(
      { key: 'note', content: 'remember this' },
      makeCtx(user.id),
    );
    expect(JSON.parse(saveResult).success).toBe(true);

    const searchResult = await searchTool.execute({ query: 'remember' }, makeCtx(user.id));
    const parsed = JSON.parse(searchResult);
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].key).toBe('note');

    testDb.cleanup();
    rmSync(workspace, { recursive: true, force: true });
  });
});

import { describe, it, expect } from 'vitest';
import { Database } from '../../src/database/Database.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { createTestDatabase } from './helpers.js';

describe('Database', () => {
  it('initializes and applies migrations', () => {
    const { db, cleanup } = createTestDatabase();
    expect(db.getRaw().open).toBe(true);
    const migrations = db
      .getRaw()
      .prepare('SELECT * FROM migrations')
      .all();
    expect(migrations.length).toBeGreaterThan(0);
    cleanup();
  });

  it('enables WAL mode', () => {
    const { db, cleanup } = createTestDatabase();
    const result = db.getRaw().prepare('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    expect(result.journal_mode.toLowerCase()).toBe('wal');
    cleanup();
  });

  it('enables foreign keys', () => {
    const { db, cleanup } = createTestDatabase();
    const result = db.getRaw().prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number;
    };
    expect(result.foreign_keys).toBe(1);
    cleanup();
  });

  it('sets busy timeout', () => {
    const { db, cleanup } = createTestDatabase();
    const result = db.getRaw().prepare('PRAGMA busy_timeout').get() as {
      timeout: number;
    };
    expect(result.timeout).toBe(5000);
    cleanup();
  });

  it('does not duplicate migrations on reopen', () => {
    const { db, dbPath, cleanup } = createTestDatabase();
    const before = (
      db.getRaw().prepare('SELECT COUNT(*) as c FROM migrations').get() as {
        c: number;
      }
    ).c;
    db.close();

    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: dbPath,
    });
    const db2 = new Database(config, createLogger(config));
    db2.open();
    const after = (
      db2.getRaw().prepare('SELECT COUNT(*) as c FROM migrations').get() as {
        c: number;
      }
    ).c;
    expect(after).toBe(before);
    db2.close();
    cleanup();
  });

  it('enforces foreign key constraints', () => {
    const { db, cleanup } = createTestDatabase();
    expect(() => {
      db
        .getRaw()
        .prepare('INSERT INTO sessions (user_id, title) VALUES (?, ?)')
        .run(9999, 'orphan');
    }).toThrow();
    cleanup();
  });

  it('rolls back transactions on error', () => {
    const { db, cleanup } = createTestDatabase();
    const userInput = {
      telegram_user_id: 'tx_test',
      language: 'id',
      status: 'active',
    };

    expect(() =>
      db.transaction(() => {
        db.repositories.users.create(userInput);
        throw new Error('intentional failure');
      }),
    ).toThrow('intentional failure');

    const found = db.repositories.users.findByTelegramUserId('tx_test');
    expect(found).toBeUndefined();
    cleanup();
  });
});

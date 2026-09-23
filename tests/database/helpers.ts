import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from '../../src/database/Database.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';

export function createTestDatabase(): {
  db: Database;
  dbPath: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-test-'));
  const dbPath = join(dir, `agent-${randomUUID()}.db`);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: dbPath,
  });
  const logger = createLogger(config);
  const db = new Database(config, logger);
  db.open();

  return {
    db,
    dbPath,
    cleanup: () => {
      db.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // On Windows the native SQLite handle may still be locked briefly
        // after close. The temp directory is unique, so leaving it is safe.
      }
    },
  };
}


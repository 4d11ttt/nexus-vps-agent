import type { Logger } from 'pino';
import { InternalError } from '../errors.js';
import type { DbConnection } from './types.js';

export interface Migration {
  name: string;
  up: string;
}

export class MigrationRunner {
  constructor(
    private readonly getConnection: () => DbConnection,
    private readonly logger: Logger,
  ) {}

  run(migrations: Migration[]): void {
    const db = this.getConnection();

    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const appliedRows = db
      .prepare('SELECT name FROM migrations')
      .all() as Array<{ name: string; _metadata?: unknown }>;
    const applied = new Set(appliedRows.map((row) => row.name));

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        this.logger.debug({ migration: migration.name }, 'Migration already applied');
        continue;
      }
      this.apply(migration);
    }
  }

  private apply(migration: Migration): void {
    const db = this.getConnection();
    this.logger.info({ migration: migration.name }, 'Applying migration');

    try {
      db.transaction(() => {
        db.exec(migration.up);
        db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
      })();
    } catch (error) {
      this.logger.error({ migration: migration.name, error }, 'Migration failed');
      throw new InternalError(`Migration ${migration.name} failed`, { cause: error });
    }
  }
}

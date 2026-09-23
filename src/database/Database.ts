import LibsqlDatabase from 'libsql';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import { InternalError } from '../errors.js';
import { MigrationRunner } from './MigrationRunner.js';
import { migrations } from './migrations/index.js';
import * as repositories from './repositories/index.js';
import type { DbConnection } from './types.js';

export class Database {
  private db: DbConnection | null = null;
  private readonly migrationRunner: MigrationRunner;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    this.migrationRunner = new MigrationRunner(() => this.getRaw(), logger);
  }

  open(): void {
    const dbPath = resolve(this.config.DATABASE_PATH);
    mkdirSync(dirname(dbPath), { recursive: true });

    this.logger.info({ dbPath }, 'Opening SQLite database');
    this.db = new LibsqlDatabase(dbPath);
    this.configurePragmas();
    this.migrationRunner.run(migrations);
    this.logger.info('Database initialized and migrations applied');
  }

  private configurePragmas(): void {
    const db = this.getRaw();
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.logger.info('Database closed');
    }
  }

  getRaw(): DbConnection {
    if (!this.db) {
      throw new InternalError('Database connection is not open');
    }
    return this.db;
  }

  transaction<T>(fn: () => T): T {
    return this.getRaw().transaction(fn)();
  }

  get repositories() {
    const db = this.getRaw();
    return {
      users: new repositories.UserRepository(db),
      sessions: new repositories.SessionRepository(db),
      messages: new repositories.MessageRepository(db),
      toolCalls: new repositories.ToolCallRepository(db),
      memories: new repositories.MemoryRepository(db),
      skills: new repositories.SkillRepository(db),
      jobs: new repositories.JobRepository(db),
      auditEvents: new repositories.AuditEventRepository(db),
    };
  }
}

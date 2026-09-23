import type { Migration } from '../MigrationRunner.js';

/**
 * Adds per-user key/value settings.
 *
 * Used for Telegram Control Center preferences such as the selected LLM model.
 * Values are plain strings; secrets are never stored here.
 */
export const migration: Migration = {
  name: '003_user_settings',
  up: `
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
  `,
};

import type { Database } from '../database/Database.js';

const MODEL_KEY = 'preferred_model';

/**
 * Per-user key/value settings.
 *
 * Persist small, non-secret user preferences such as the selected LLM model.
 * Secrets must never be written through this service.
 */
export class UserSettingsService {
  constructor(private readonly db: Database) {}

  get(userId: number, key: string): string | undefined {
    const row = this.db
      .getRaw()
      .prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
      .get(userId, key) as { value: string } | undefined;
    return row?.value;
  }

  set(userId: number, key: string, value: string): void {
    this.db
      .getRaw()
      .prepare(
        `INSERT INTO user_settings (user_id, key, value)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET
           value = excluded.value,
           updated_at = datetime('now')`,
      )
      .run(userId, key, value);
  }

  getModel(userId: number): string | undefined {
    return this.get(userId, MODEL_KEY);
  }

  setModel(userId: number, modelId: string): void {
    this.set(userId, MODEL_KEY, modelId);
  }
}

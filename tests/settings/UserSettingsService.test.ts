import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserSettingsService } from '../../src/settings/UserSettingsService.js';
import { createTestDatabase } from '../database/helpers.js';
import type { Database } from '../../src/database/Database.js';

describe('UserSettingsService', () => {
  let db: Database;
  let cleanup: () => void;
  let service: UserSettingsService;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    service = new UserSettingsService(db);
    db.repositories.users.create({ telegram_user_id: '1' });
    db.repositories.users.create({ telegram_user_id: '2' });
  });

  afterEach(() => {
    cleanup();
  });

  it('returns undefined for missing keys', () => {
    expect(service.get(1, 'preferred_model')).toBeUndefined();
  });

  it('persists and updates per-user model preferences', () => {
    service.setModel(1, 'gpt-4');
    expect(service.getModel(1)).toBe('gpt-4');

    service.setModel(1, 'claude-3');
    expect(service.getModel(1)).toBe('claude-3');
  });

  it('keeps preferences isolated per user', () => {
    service.setModel(1, 'model-a');
    service.setModel(2, 'model-b');
    expect(service.getModel(1)).toBe('model-a');
    expect(service.getModel(2)).toBe('model-b');
  });
});


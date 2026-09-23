import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { Scheduler } from '../../src/scheduler/Scheduler.js';
import { createSchedulerTools } from '../../src/scheduler/tools.js';
import { createTestDatabase } from '../database/helpers.js';
import { loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import type { ToolContext } from '../../src/tools/context.js';

function makeConfig(): Config {
  return loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
}

function makeCtx(userId: number, config: Config): ToolContext {
  return { logger: pino({ level: 'silent' }), config, userId, sessionId: 1 };
}

describe('scheduler tools', () => {
  it('schedule_create, schedule_list and schedule_cancel are user-scoped', async () => {
    const testDb = createTestDatabase();
    const config = makeConfig();
    const runner = { run: vi.fn(async () => ({ response: 'ok', finishReason: 'completed' })) };
    const scheduler = new Scheduler({ db: testDb.db, config, logger: pino({ level: 'silent' }), runner });
    const tools = createSchedulerTools(scheduler);

    const user = testDb.db.repositories.users.create({ telegram_user_id: 'tools', status: 'active' });
    const ctx = makeCtx(user.id, config);

    const createTool = tools.find((t) => t.name === 'schedule_create')!;
    const listTool = tools.find((t) => t.name === 'schedule_list')!;
    const cancelTool = tools.find((t) => t.name === 'schedule_cancel')!;

    const created = JSON.parse(
      await createTool.execute(
        {
          name: 'j',
          instruction: 'run task',
          schedule: { type: 'once', at: '2000-01-01T00:00:00.000Z' },
        },
        ctx,
      ),
    );
    expect(created.success).toBe(true);

    const listed = JSON.parse(await listTool.execute({}, ctx));
    expect(listed.count).toBe(1);

    const cancelled = JSON.parse(await cancelTool.execute({ id: created.id }, ctx));
    expect(cancelled.success).toBe(true);

    testDb.cleanup();
  });
});

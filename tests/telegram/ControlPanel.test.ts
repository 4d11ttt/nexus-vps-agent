import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ControlPanel } from '../../src/telegram/ControlPanel.js';
import type { Context } from 'grammy';
import type { Config } from '../../src/config.js';
import type { SessionManager } from '../../src/agent/SessionManager.js';
import type { MemoryManager } from '../../src/memory/MemoryManager.js';
import type { SkillManager } from '../../src/skills/SkillManager.js';
import type { ModelCatalog } from '../../src/llm/ModelCatalog.js';
import type { UserSettingsService } from '../../src/settings/UserSettingsService.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: './data/agent.db',
    AGENT_MAX_ITERATIONS: 50,
    TOOL_SHELL_TIMEOUT_MS: 300_000,
    TOOL_MAX_OUTPUT_BYTES: 1_048_576,
    LLM_TIMEOUT_MS: 120_000,
    LLM_MAX_RETRIES: 3,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: 'fake-token',
    TELEGRAM_ALLOWED_USER_IDS: [123],
    LLM_API_BASE: 'https://api.example.com/v1',
    LLM_API_KEY: 'fake-key',
    LLM_MODEL: 'default-model',
    ...overrides,
  } as Config;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as import('pino').Logger;
}

class FakeBot {
  commands = new Map<string, (ctx: Context) => Promise<void>>();
  events = new Map<string, (ctx: Context) => Promise<void>>();

  command(name: string, handler: (ctx: Context) => Promise<void>) {
    this.commands.set(name, handler);
  }

  on(event: string, handler: (ctx: Context) => Promise<void>) {
    this.events.set(event, handler);
  }
}

function makeContext(overrides: {
  userId?: number;
  data?: string;
  chatType?: string;
  text?: string;
}): Context {
  const from = overrides.userId !== undefined ? { id: overrides.userId, username: 'alice', first_name: 'Alice' } : undefined;
  return {
    message: overrides.text !== undefined ? { text: overrides.text, from } : undefined,
    from,
    chat: { type: overrides.chatType ?? 'private' },
    callbackQuery: overrides.data !== undefined ? { data: overrides.data, from } : undefined,
    reply: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}


describe('ControlPanel', () => {
  let bot: FakeBot;
  let modelCatalog: ModelCatalog;
  let userSettings: UserSettingsService;
  let memoryManager: MemoryManager;
  let skillManager: SkillManager;
  let sessionManager: SessionManager;
  let panel: ControlPanel;

  beforeEach(() => {
    bot = new FakeBot();
    modelCatalog = {
      listModels: vi.fn().mockResolvedValue([
        { id: 'model-a' },
        { id: 'model-b' },
        { id: 'model-c' },
      ]),
      testConnection: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    } as unknown as ModelCatalog;

    userSettings = {
      getModel: vi.fn().mockReturnValue(undefined),
      setModel: vi.fn(),
    } as unknown as UserSettingsService;

    memoryManager = {
      list: vi.fn().mockReturnValue([]),
    } as unknown as MemoryManager;

    skillManager = {
      list: vi.fn().mockReturnValue([]),
      discover: vi.fn(),
    } as unknown as SkillManager;

    sessionManager = {
      ensureUser: vi.fn().mockResolvedValue({ id: 1, telegram_user_id: '123' }),
      findLatestActiveSession: vi.fn().mockResolvedValue({ id: 10 }),
      getOrCreateSession: vi.fn().mockResolvedValue({ id: 10 }),
    } as unknown as SessionManager;

    panel = new ControlPanel({
      config: makeConfig(),
      modelCatalog,
      userSettings,
      memoryManager,
      skillManager,
      sessionManager,
      logger: makeLogger(),
    });

    panel.register(bot as unknown as import('grammy').Bot);
  });

  it('registers /menu and /model commands', () => {
    expect(bot.commands.has('menu')).toBe(true);
    expect(bot.commands.has('model')).toBe(true);
  });

  it('registers callback query handler', () => {
    expect(bot.events.has('callback_query:data')).toBe(true);
  });

  it('opens the main menu on /menu with all control center buttons', async () => {
    const ctx = makeContext({ userId: 123, text: '/menu' });
    const handler = bot.commands.get('menu')!;
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('NEXUS VPS'),
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
    const markup = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1]?.reply_markup as {
      inline_keyboard: Array<Array<{ text: string }>>;
    };
    const labels = markup.inline_keyboard.flat().map((b) => b.text).join(' ');
    for (const expected of [
      'Model',
      'Provider',
      'Memory',
      'Skills',
      'System',
      'Resources',
      'Processes',
      'Storage',
      'Network',
      'Telegram',
      'WebSocket',
      'Scheduler',
      'Jobs',
      'Settings',
      'Logs',
      'Audit',
      'Refresh',
      'About',
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it('opens the model menu on /model', async () => {
    const ctx = makeContext({ userId: 123, text: '/model' });
    const handler = bot.commands.get('model')!;
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Model'),
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
  });

  it('rejects unauthorized users', async () => {
    const ctx = makeContext({ userId: 999, data: 'menu:main' });
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Unauthorized' });
  });

  it('navigates to the model menu', async () => {
    const ctx = makeContext({ userId: 123, data: 'menu:model' });
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('Model'),
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
  });

  it('lists models with pagination', async () => {
    const ctx = makeContext({ userId: 123, data: 'menu:model:list:0' });
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    const call = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('Select Model');
    const markup = call[1]?.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined;
    const labels = markup?.inline_keyboard.flat().map((b) => b.text) ?? [];
    expect(labels.some((l) => l.includes('model-a'))).toBe(true);
  });

  it('selects a model and persists it', async () => {
    const ctxList = makeContext({ userId: 123, data: 'menu:model:list:0' });
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctxList);

    const ctxSelect = makeContext({ userId: 123, data: 'menu:model:select:m0' });
    await handler(ctxSelect);

    expect(userSettings.setModel).toHaveBeenCalledWith(1, 'model-a');
    expect(ctxSelect.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Model set to model-a' });
  });

  it('navigates back to the main menu', async () => {
    const ctx = makeContext({ userId: 123, data: 'menu:main' });
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('NEXUS VPS'),
      expect.anything(),
    );
  });

  it('shows provider status without exposing the API key', async () => {
    const ctx = makeContext({ userId: 123, data: 'menu:provider' });
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    const call = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toContain('Provider');
    expect(call).toContain('api.example.com/v1');
    expect(call).not.toContain('fake-key');
  });

  it('answers callback queries on every action', async () => {
    const handler = bot.events.get('callback_query:data')!;
    const callbacks = ['menu:main', 'menu:model', 'menu:model:list:0', 'menu:provider', 'menu:provider:test', 'menu:settings'];
    for (const data of callbacks) {
      const ctx = makeContext({ userId: 123, data });
      await handler(ctx);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    }
  });
});


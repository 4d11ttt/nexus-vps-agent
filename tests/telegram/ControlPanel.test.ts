import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ControlPanel, isMessageNotModifiedError, parentMenuOf } from '../../src/telegram/ControlPanel.js';
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
  let logger: ReturnType<typeof makeLogger>;
  let panel: ControlPanel;

  beforeEach(() => {
    bot = new FakeBot();
    logger = makeLogger();
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
      read: vi.fn().mockReturnValue('# Skill'),
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
      logger,
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

  it('opens the main menu as a grouped category menu', async () => {
    const ctx = makeContext({ userId: 123, text: '/menu' });
    const handler = bot.commands.get('menu')!;
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('NEXUS VPS'),
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
    const markup = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1]?.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const buttons = markup.inline_keyboard.flat();
    const labels = buttons.map((b) => b.text).join(' ');
    for (const expected of [
      'Agent',
      'Server',
      'Intelligence',
      'Automation',
      'Channels',
      'Monitoring',
      'Settings',
    ]) {
      expect(labels).toContain(expected);
    }
    // Category buttons only: feature screens live in their submenus.
    for (const hidden of [
      'Model',
      'Provider',
      'Memory',
      'Skills',
      'Resources',
      'Processes',
      'Storage',
      'Network',
      'Scheduler',
      'Logs',
      'About',
      'Refresh',
    ]) {
      expect(labels).not.toContain(hidden);
    }
    expect(buttons.map((b) => b.callback_data)).toEqual([
      'menu:agent',
      'menu:server',
      'menu:intelligence',
      'menu:automation',
      'menu:channels',
      'menu:monitoring',
      'menu:settings',
    ]);
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
    const callbacks = [
      'menu:main',
      'menu:agent',
      'menu:server',
      'menu:intelligence',
      'menu:automation',
      'menu:monitoring',
      'menu:channels',
      'menu:channels:telegram',
      'menu:channels:websocket',
      'menu:settings',
      'menu:about',
      'menu:model',
      'menu:model:list:0',
      'menu:provider',
      'menu:provider:test',
      'menu:memory',
      'menu:memory:browse',
      'menu:skills',
      'menu:skills:list',
      'menu:system',
      'menu:resources',
      'menu:processes',
      'menu:storage',
      'menu:network',
      'menu:scheduler',
      'menu:jobs',
      'menu:logs',
      'menu:audit',
    ];
    for (const data of callbacks) {
      const ctx = makeContext({ userId: 123, data });
      await handler(ctx);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    }
  });

  type KeyboardButton = { text: string; callback_data?: string };
  type ReplyMarkup = { inline_keyboard: KeyboardButton[][] };

  function lastKeyboard(ctx: Context): ReplyMarkup | undefined {
    const calls = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls;
    if (calls.length === 0) return undefined;
    return calls[calls.length - 1][1]?.reply_markup as ReplyMarkup | undefined;
  }

  function findBackButton(keyboard: ReplyMarkup | undefined): KeyboardButton | undefined {
    return keyboard?.inline_keyboard.flat().find((b) => b.text.includes('Back'));
  }

  it('maps every screen Back button to its explicit parent menu', async () => {
    const handler = bot.events.get('callback_query:data')!;
    const cases: Array<[screen: string, parent: string]> = [
      ['menu:agent', 'menu:main'],
      ['menu:server', 'menu:main'],
      ['menu:intelligence', 'menu:main'],
      ['menu:automation', 'menu:main'],
      ['menu:monitoring', 'menu:main'],
      ['menu:channels', 'menu:main'],
      ['menu:settings', 'menu:main'],
      ['menu:model', 'menu:agent'],
      ['menu:provider', 'menu:agent'],
      ['menu:system', 'menu:server'],
      ['menu:resources', 'menu:server'],
      ['menu:processes', 'menu:server'],
      ['menu:storage', 'menu:server'],
      ['menu:network', 'menu:server'],
      ['menu:memory', 'menu:intelligence'],
      ['menu:skills', 'menu:intelligence'],
      ['menu:scheduler', 'menu:automation'],
      ['menu:jobs', 'menu:automation'],
      ['menu:logs', 'menu:monitoring'],
      ['menu:audit', 'menu:monitoring'],
      ['menu:about', 'menu:settings'],
      ['menu:model:list:0', 'menu:model'],
      ['menu:memory:browse', 'menu:memory'],
      ['menu:skills:list', 'menu:skills'],
      ['menu:channels:telegram', 'menu:channels'],
      ['menu:channels:websocket', 'menu:channels'],
    ];
    for (const [screen, parent] of cases) {
      const ctx = makeContext({ userId: 123, data: screen });
      await handler(ctx);
      const back = findBackButton(lastKeyboard(ctx));
      expect(back, `Back button missing for ${screen}`).toBeDefined();
      expect(back!.callback_data, `Back target for ${screen}`).toBe(parent);
      // A Back button must never navigate onto the screen already shown.
      expect(back!.callback_data, `Self-loop on ${screen}`).not.toBe(screen);
    }
  });

  it('parentMenuOf never returns the screen itself', () => {
    const screens = [
      'agent', 'server', 'intelligence', 'automation', 'channels', 'monitoring',
      'settings', 'model', 'provider', 'system', 'resources', 'processes',
      'storage', 'network', 'memory', 'skills', 'scheduler', 'jobs', 'logs',
      'audit', 'about',
    ];
    for (const screen of screens) {
      expect(parentMenuOf(screen)).not.toBe(screen);
    }
    expect(parentMenuOf('unknown-screen')).toBe('main');
  });

  it('answers "message is not modified" edits as success without logging an error', async () => {
    const ctx = makeContext({ userId: 123, data: 'menu:resources' });
    const notModified = Object.assign(new Error('Call to editMessageText failed!'), {
      error_code: 400,
      description: 'Bad Request: message is not modified',
      response: { description: 'Bad Request: message is not modified' },
    });
    (ctx.editMessageText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(notModified);
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalledWith({ text: 'Action failed' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('surfaces other edit errors as Action failed', async () => {
    const ctx = makeContext({ userId: 123, data: 'menu:resources' });
    (ctx.editMessageText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('chat not found'),
    );
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Action failed' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('shows only real channel statuses', async () => {
    const handler = bot.events.get('callback_query:data')!;
    const ctx = makeContext({ userId: 123, data: 'menu:channels' });
    await handler(ctx);
    const text = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain('Enabled');
    expect(text).toContain('Not available');
    expect(text).not.toContain('Connected');

    const wsCtx = makeContext({ userId: 123, data: 'menu:channels:websocket' });
    await handler(wsCtx);
    const wsText = (wsCtx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(wsText).not.toContain('Connected');
  });

  it('exposes only safe runtime settings with an About entry point', async () => {
    const ctx = makeContext({ userId: 123, data: 'menu:settings' });
    const handler = bot.events.get('callback_query:data')!;
    await handler(ctx);
    const text = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain('Settings');
    expect(text).not.toContain('fake-key');
    expect(text).not.toContain('fake-token');
    const keyboard = lastKeyboard(ctx);
    const labels = keyboard?.inline_keyboard.flat().map((b) => b.text) ?? [];
    expect(labels.some((l) => l.includes('About'))).toBe(true);
    expect(findBackButton(keyboard)?.callback_data).toBe('menu:main');
  });
});

describe('isMessageNotModifiedError', () => {
  it('matches Telegram 400 description shapes', () => {
    expect(isMessageNotModifiedError(new Error('Bad Request: message is not modified'))).toBe(true);

    const withDescription = Object.assign(new Error('Call to editMessageText failed!'), {
      description: 'Bad Request: message is not modified',
    });
    expect(isMessageNotModifiedError(withDescription)).toBe(true);

    const withResponse = Object.assign(new Error('tg error'), {
      response: { description: 'Bad Request: message is not modified' },
    });
    expect(isMessageNotModifiedError(withResponse)).toBe(true);

    const withPayload = Object.assign(new Error('tg error'), {
      payload: { description: 'Bad Request: message is not modified' },
    });
    expect(isMessageNotModifiedError(withPayload)).toBe(true);
  });

  it('rejects unrelated errors and non-errors', () => {
    expect(isMessageNotModifiedError(new Error('chat not found'))).toBe(false);
    expect(isMessageNotModifiedError('message is not modified')).toBe(false);
    expect(isMessageNotModifiedError(undefined)).toBe(false);
    expect(isMessageNotModifiedError({ description: 'message is not modified' })).toBe(false);
  });
});


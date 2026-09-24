import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'grammy';
import { Bot } from 'grammy';
import { LLMRuntimeConfig } from '../../src/llm/LLMRuntimeConfig.js';
import { TelegramBot } from '../../src/telegram/TelegramBot.js';
import type { Config } from '../../src/config.js';

vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>();

  class FakeBot {
    static order: string[] = [];
    commands = new Map<string, (ctx: Context) => Promise<void>>();
    events = new Map<string, (ctx: Context) => Promise<void>>();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);

    command(name: string, handler: (ctx: Context) => Promise<void>) {
      FakeBot.order.push(`command:${name}`);
      this.commands.set(name, handler);
    }

    on(event: string, handler: (ctx: Context) => Promise<void>) {
      FakeBot.order.push(`event:${event}`);
      this.events.set(event, handler);
    }
  }

  return { ...actual, Bot: FakeBot as unknown as typeof actual.Bot };
});

function makeConfig(): Config {
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

describe('TelegramBot', () => {
  it('registers handlers and starts/stops polling', async () => {
    const fakeAgentCore = { run: vi.fn() } as unknown as import('../../src/agent/AgentCore.js').AgentCore;
    const fakeSessionManager = {
      ensureUser: vi.fn().mockResolvedValue({ id: 1 }),
      findLatestActiveSession: vi.fn().mockResolvedValue({ id: 10 }),
    } as unknown as import('../../src/agent/SessionManager.js').SessionManager;

    const bot = new TelegramBot({
      config: makeConfig(),
      agentCore: fakeAgentCore,
      sessionManager: fakeSessionManager,
      logger: makeLogger(),
    });

    const startSpy = vi.spyOn(bot, 'start');
    const stopSpy = vi.spyOn(bot, 'stop');

    await bot.start();
    await bot.stop();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when the token is missing', () => {
    expect(
      () =>
        new TelegramBot({
          config: { ...makeConfig(), TELEGRAM_BOT_TOKEN: undefined } as Config,
          agentCore: { run: vi.fn() } as unknown as import('../../src/agent/AgentCore.js').AgentCore,
          sessionManager: {} as import('../../src/agent/SessionManager.js').SessionManager,
          logger: makeLogger(),
        }),
    ).toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('registers ControlPanel commands before the generic message handler', () => {
    const order = (Bot as unknown as { order: string[] }).order;
    order.length = 0;

    new TelegramBot({
      config: makeConfig(),
      agentCore: { run: vi.fn() } as unknown as import('../../src/agent/AgentCore.js').AgentCore,
      sessionManager: {
        ensureUser: vi.fn().mockResolvedValue({ id: 1 }),
        findLatestActiveSession: vi.fn().mockResolvedValue({ id: 10 }),
        getOrCreateSession: vi.fn().mockResolvedValue({ id: 10 }),
      } as unknown as import('../../src/agent/SessionManager.js').SessionManager,
      logger: makeLogger(),
      db: {} as unknown as import('../../src/database/Database.js').Database,
      modelCatalog: {
        listModels: vi.fn(),
        testConnection: vi.fn(),
      } as unknown as import('../../src/llm/ModelCatalog.js').ModelCatalog,
      runtimeConfig: new LLMRuntimeConfig(makeConfig()),
      userSettings: {
        getModel: vi.fn(),
        setModel: vi.fn(),
      } as unknown as import('../../src/settings/UserSettingsService.js').UserSettingsService,
      memoryManager: {
        list: vi.fn(),
      } as unknown as import('../../src/memory/MemoryManager.js').MemoryManager,
      skillManager: {
        list: vi.fn(),
        discover: vi.fn(),
        read: vi.fn(),
      } as unknown as import('../../src/skills/SkillManager.js').SkillManager,
    });

    expect(order).toContain('command:menu');
    expect(order).toContain('command:model');
    expect(order).toContain('command:start');
    expect(order.indexOf('command:menu')).toBeLessThan(order.indexOf('event:message:text'));
    expect(order.indexOf('command:model')).toBeLessThan(order.indexOf('event:message:text'));
    expect(order.indexOf('command:start')).toBeLessThan(order.indexOf('event:message:text'));
  });
});


import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'grammy';
import { TelegramBot } from '../../src/telegram/TelegramBot.js';
import type { Config } from '../../src/config.js';

vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>();

  class FakeBot {
    commands = new Map<string, (ctx: Context) => Promise<void>>();
    events = new Map<string, (ctx: Context) => Promise<void>>();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);

    command(name: string, handler: (ctx: Context) => Promise<void>) {
      this.commands.set(name, handler);
    }

    on(event: string, handler: (ctx: Context) => Promise<void>) {
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
});


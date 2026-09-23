import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bot } from 'grammy';
import type { Context } from 'grammy';
import { registerTelegramHandlers } from '../../src/telegram/handlers.js';
import type { AgentCore } from '../../src/agent/AgentCore.js';
import type { SessionManager } from '../../src/agent/SessionManager.js';
import type { Config } from '../../src/config.js';
import type { Logger } from 'pino';
import type { User, Session } from '../../src/database/types.js';

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

function makeContext(overrides: {
  userId?: number;
  chatType?: string;
  text?: string;
}): Context {
  const from = overrides.userId !== undefined ? { id: overrides.userId } : undefined;
  return {
    message:
      overrides.text !== undefined
        ? { text: overrides.text, from }
        : undefined,
    from,
    chat: { type: overrides.chatType ?? 'private' },
    reply: vi.fn().mockResolvedValue(undefined),
    replyWithChatAction: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function makeConfig(partial: Partial<Config> = {}): Config {
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
    ...partial,
  } as Config;
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeSessionManager(user: User, session: Session): SessionManager {
  return {
    ensureUser: vi.fn().mockResolvedValue(user),
    findLatestActiveSession: vi.fn().mockResolvedValue(session),
    getOrCreateSession: vi.fn().mockResolvedValue(session),
  } as unknown as SessionManager;
}

describe('registerTelegramHandlers', () => {
  let bot: import('grammy').Bot;
  let fakeBot: { commands: Map<string, Function>; events: Map<string, Function> };
  let agentCore: AgentCore;
  let sessionManager: SessionManager;
  let logger: Logger;
  const user: User = {
    id: 1,
    telegram_user_id: '123',
    username: null,
    display_name: null,
    language: 'id',
    status: 'active',
    created_at: '',
    updated_at: '',
  };
  const session: Session = {
    id: 10,
    user_id: 1,
    title: null,
    status: 'active',
    created_at: '',
    updated_at: '',
  };

  beforeEach(() => {
    fakeBot = new Bot('fake') as unknown as {
      commands: Map<string, Function>;
      events: Map<string, Function>;
    };
    bot = fakeBot as unknown as import('grammy').Bot;
    agentCore = {
      run: vi.fn().mockResolvedValue({
        response: 'Done',
        sessionId: 10,
        iterations: 1,
        toolCalls: 0,
        usage: undefined,
        finishReason: 'completed',
      }),
    } as unknown as AgentCore;
    sessionManager = makeSessionManager(user, session);
    logger = makeLogger();
    registerTelegramHandlers(bot, {
      config: makeConfig(),
      agentCore,
      sessionManager,
      logger,
    });
  });

  it('rejects unauthorized users', async () => {
    const ctx = makeContext({ userId: 999, text: 'hello' });
    const textHandler = fakeBot.events.get('message:text');
    expect(textHandler).toBeDefined();
    await textHandler!(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('You are not authorized to use this bot.');
    expect(agentCore.run).not.toHaveBeenCalled();
  });

  it('rejects messages without a user', async () => {
    const ctx = makeContext({ text: 'hello' });
    const textHandler = fakeBot.events.get('message:text');
    await textHandler!(ctx);
    expect(agentCore.run).not.toHaveBeenCalled();
  });

  it('replies to /start', async () => {
    const ctx = makeContext({ userId: 123, text: '/start' });
    const handler = fakeBot.commands.get('start');
    await handler!(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Halo!'));
  });

  it('replies to /help', async () => {
    const ctx = makeContext({ userId: 123, text: '/help' });
    const handler = fakeBot.commands.get('help');
    await handler!(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Cara menggunakan'));
  });

  it('replies to /status without secrets', async () => {
    const ctx = makeContext({ userId: 123, text: '/status' });
    const handler = fakeBot.commands.get('status');
    await handler!(ctx);
    const reply = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(reply).toContain('Aktif');
    expect(reply).not.toContain('TELEGRAM_BOT_TOKEN');
    expect(reply).not.toContain('fake-token');
  });

  it('invokes AgentCore on a text message and sends the response', async () => {
    const ctx = makeContext({ userId: 123, text: 'cek RAM VPS' });
    const textHandler = fakeBot.events.get('message:text');
    await textHandler!(ctx);
    expect(ctx.replyWithChatAction).toHaveBeenCalledWith('typing');
    expect(agentCore.run).toHaveBeenCalledWith({
      userId: 1,
      sessionId: 10,
      message: 'cek RAM VPS',
    });
    expect(ctx.reply).toHaveBeenCalledWith('Done');
  });

  it('splits long responses into multiple messages', async () => {
    const longResponse = 'A'.repeat(4000);
    (agentCore.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      response: longResponse,
      sessionId: 10,
      iterations: 1,
      toolCalls: 0,
      usage: undefined,
      finishReason: 'completed',
    });
    const ctx = makeContext({ userId: 123, text: 'long' });
    const textHandler = fakeBot.events.get('message:text');
    await textHandler!(ctx);
    expect((ctx.reply as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('handles AgentCore errors gracefully', async () => {
    (agentCore.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const ctx = makeContext({ userId: 123, text: 'fail' });
    const textHandler = fakeBot.events.get('message:text');
    await textHandler!(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('kesalahan'),
    );
  });
});


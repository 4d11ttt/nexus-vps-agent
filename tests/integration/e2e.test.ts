import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import pino from 'pino';
import { Bot as GrammyBot } from 'grammy';
import type { Context } from 'grammy';
import { registerTelegramHandlers } from '../../src/telegram/handlers.js';
import { AgentCore } from '../../src/agent/AgentCore.js';
import { SessionManager } from '../../src/agent/SessionManager.js';
import { ToolRegistry } from '../../src/agent/ToolRegistry.js';
import { AuditService } from '../../src/audit/AuditService.js';
import { loadConfig } from '../../src/config.js';
import { createTestDatabase } from '../database/helpers.js';
import type { Database } from '../../src/database/Database.js';
import type { ChatResponse, LLMProvider, ToolCall } from '../../src/llm/types.js';

// Mock grammY so no real Telegram API is ever contacted.
vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>();
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
  return { ...actual, Bot: FakeBot as unknown as typeof actual.Bot };
});

function createConfig() {
  return loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', AGENT_MAX_ITERATIONS: '10' });
}

function finalResponse(content: string): ChatResponse {
  return {
    message: { role: 'assistant', content },
    toolCalls: [],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  };
}

function toolCallResponse(toolCalls: ToolCall[]): ChatResponse {
  return {
    message: { role: 'assistant', content: '' },
    toolCalls,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  };
}

function createFakeLLM(responses: ChatResponse[]): LLMProvider {
  const queue = [...responses];
  return {
    chat: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('LLM mock exhausted');
      return next;
    }),
    streamChat: vi.fn(async function* () {}),
    getCapabilities: vi.fn(() => ({
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsReasoning: false,
    })),
  };
}

function makeContext(userId: number, text: string): Context {
  return {
    message: { text, from: { id: userId } },
    from: { id: userId },
    chat: { type: 'private' },
    reply: vi.fn().mockResolvedValue(undefined),
    replyWithChatAction: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe('End-to-end Telegram -> AgentCore -> Tool pipeline', () => {
  let db: Database;
  let cleanup: () => void;
  let fakeBot: { commands: Map<string, Function>; events: Map<string, Function> };

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    fakeBot = new GrammyBot('fake-token') as unknown as {
      commands: Map<string, Function>;
      events: Map<string, Function>;
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('routes an authorized message through the full agent pipeline', async () => {
    const config = createConfig();
    const registry = new ToolRegistry();
    registry.register({
      name: 'package_check',
      description: 'Check if a package is installed',
      parameters: z.object({ package: z.string() }),
      parameterSchema: {
        type: 'object',
        properties: { package: { type: 'string' } },
        required: ['package'],
      },
      execute: async (args) =>
        JSON.stringify({ installed: false, package: (args as { package: string }).package }),
    });

    const llm = createFakeLLM([
      toolCallResponse([{ id: 'c1', name: 'package_check', arguments: '{"package":"nginx"}' }]),
      finalResponse('nginx belum terpasang.'),
    ]);

    const sessionManager = new SessionManager({ db });
    const audit = new AuditService(db);
    const agentCore = new AgentCore({
      llm,
      db,
      config,
      logger: pino({ level: 'silent' }),
      registry,
      sessionManager,
      audit,
    });

    registerTelegramHandlers(fakeBot as unknown as GrammyBot, {
      config: { ...config, TELEGRAM_ENABLED: true, TELEGRAM_ALLOWED_USER_IDS: [42] },
      agentCore,
      sessionManager,
      logger: pino({ level: 'silent' }),
      audit,
    });

    const ctx = makeContext(42, 'cek nginx');
    const textHandler = fakeBot.events.get('message:text')!;
    await textHandler(ctx);

    expect(ctx.replyWithChatAction).toHaveBeenCalledWith('typing');
    expect(ctx.reply).toHaveBeenCalledWith('nginx belum terpasang.');

    const toolCalls = db.repositories.toolCalls.findAll();
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].tool_name).toBe('package_check');
  });

  it('rejects an unauthorized user before reaching AgentCore', async () => {
    const config = createConfig();
    const registry = new ToolRegistry();
    const llm = createFakeLLM([finalResponse('should not run')]);
    const sessionManager = new SessionManager({ db });
    const agentCore = new AgentCore({
      llm,
      db,
      config,
      logger: pino({ level: 'silent' }),
      registry,
      sessionManager,
    });

    registerTelegramHandlers(fakeBot as unknown as GrammyBot, {
      config: { ...config, TELEGRAM_ENABLED: true, TELEGRAM_ALLOWED_USER_IDS: [42] },
      agentCore,
      sessionManager,
      logger: pino({ level: 'silent' }),
    });

    const ctx = makeContext(999, 'hello');
    const textHandler = fakeBot.events.get('message:text')!;
    await textHandler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('You are not authorized to use this bot.');
    expect(llm.chat).not.toHaveBeenCalled();
    expect(db.repositories.messages.findAll().length).toBe(0);
  });

  it('performs an autonomous recover: check -> install -> verify', async () => {
    const config = createConfig();
    const registry = new ToolRegistry();

    const calls: string[] = [];
    registry.register({
      name: 'package_check',
      description: 'Check package',
      parameters: z.object({ package: z.string() }),
      parameterSchema: {
        type: 'object',
        properties: { package: { type: 'string' } },
        required: ['package'],
      },
      execute: async () => {
        calls.push('check');
        return JSON.stringify({ installed: false });
      },
    });
    registry.register({
      name: 'package_install',
      description: 'Install package',
      parameters: z.object({ package: z.string() }),
      parameterSchema: {
        type: 'object',
        properties: { package: { type: 'string' } },
        required: ['package'],
      },
      execute: async () => {
        calls.push('install');
        return JSON.stringify({ installed: true });
      },
    });
    registry.register({
      name: 'system_verify',
      description: 'Verify install',
      parameters: z.object({}),
      parameterSchema: { type: 'object', properties: {} },
      execute: async () => {
        calls.push('verify');
        return JSON.stringify({ ok: true });
      },
    });

    const llm = createFakeLLM([
      toolCallResponse([{ id: 'a', name: 'package_check', arguments: '{"package":"nginx"}' }]),
      toolCallResponse([{ id: 'b', name: 'package_install', arguments: '{"package":"nginx"}' }]),
      toolCallResponse([{ id: 'c', name: 'system_verify', arguments: '{}' }]),
      finalResponse('nginx terpasang dan terverifikasi.'),
    ]);

    const sessionManager = new SessionManager({ db });
    const agentCore = new AgentCore({
      llm,
      db,
      config,
      logger: pino({ level: 'silent' }),
      registry,
      sessionManager,
    });

    const user = db.repositories.users.create({ telegram_user_id: '7', status: 'active' });
    const result = await agentCore.run({
      userId: user.id,
      message: 'Pastikan nginx terpasang; jika belum, pasang dan verifikasi.',
    });

    expect(result.finishReason).toBe('completed');
    expect(result.response).toContain('terverifikasi');
    expect(calls).toEqual(['check', 'install', 'verify']);
    expect(result.toolCalls).toBe(3);
  });
});

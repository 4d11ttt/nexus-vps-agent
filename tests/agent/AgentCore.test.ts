import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { AgentCore } from '../../src/agent/AgentCore.js';
import { AgentCancelledError } from '../../src/agent/errors.js';
import { loadConfig } from '../../src/config.js';
import { createTestDatabase } from '../database/helpers.js';
import type { Database } from '../../src/database/Database.js';
import type { Config } from '../../src/config.js';
import type { LLMProvider, ChatResponse, ToolCall } from '../../src/llm/types.js';
import type { Logger } from 'pino';
import pino from 'pino';

function createConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: './data/agent.db',
    AGENT_MAX_ITERATIONS: '5',
    ...overrides,
  });
}

function createLogger(): Logger {
  return pino({ level: 'silent' });
}

function createMockLLM(responses: ChatResponse[]): LLMProvider {
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

function createTestTools(registry: import('../../src/agent/ToolRegistry.js').ToolRegistry) {
  registry.register({
    name: 'echo',
    description: 'Echo a message',
    parameters: z.object({ message: z.string() }),
    parameterSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    execute: (args) => (args as { message: string }).message,
  });

  registry.register({
    name: 'add',
    description: 'Add two numbers',
    parameters: z.object({ a: z.number(), b: z.number() }),
    parameterSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    execute: (args) => {
      const { a, b } = args as { a: number; b: number };
      return String(a + b);
    },
  });

  registry.register({
    name: 'fail',
    description: 'Always fails',
    parameters: z.object({}),
    parameterSchema: { type: 'object', properties: {} },
    execute: () => {
      throw new Error('intentional failure');
    },
  });
}

function createAgent(db: Database, llm: LLMProvider, maxIterations = '5') {
  return new AgentCore({
    llm,
    db,
    config: createConfig({ AGENT_MAX_ITERATIONS: maxIterations }),
    logger: createLogger(),
  });
}

async function createUser(db: Database) {
  return db.repositories.users.create({
    telegram_user_id: 'agent-test',
    language: 'id',
    status: 'active',
  });
}

describe('AgentCore', () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('returns a simple final response', async () => {
    const llm = createMockLLM([finalResponse('Hello!')]);
    const agent = createAgent(db, llm);
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Hi' });

    expect(result.response).toBe('Hello!');
    expect(result.finishReason).toBe('completed');
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.usage).toEqual({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  });

  it('executes one tool call and returns final response', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_1', name: 'echo', arguments: '{"message":"world"}' }]),
      finalResponse('Done'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Echo world' });

    expect(result.response).toBe('Done');
    expect(result.toolCalls).toBe(1);
    expect(result.iterations).toBe(2);
  });

  it('executes multiple sequential tool calls', async () => {
    const llm = createMockLLM([
      toolCallResponse([
        { id: 'call_1', name: 'add', arguments: '{"a":1,"b":2}' },
        { id: 'call_2', name: 'echo', arguments: '{"message":"ok"}' },
      ]),
      finalResponse('Finished'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Do things' });

    expect(result.toolCalls).toBe(2);
    expect(result.iterations).toBe(2);
  });

  it('handles unknown tool gracefully', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_x', name: 'missing', arguments: '{}' }]),
      finalResponse('Recovered'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Call missing' });

    expect(result.response).toBe('Recovered');
    expect(result.finishReason).toBe('completed');
  });

  it('handles malformed tool arguments', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_bad', name: 'echo', arguments: 'not json' }]),
      finalResponse('Noted'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Bad args' });

    expect(result.response).toBe('Noted');
    expect(result.finishReason).toBe('completed');
  });

  it('handles tool validation failure', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_val', name: 'add', arguments: '{"a":"x","b":2}' }]),
      finalResponse('OK'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Validate fail' });

    expect(result.response).toBe('OK');
    expect(result.finishReason).toBe('completed');
  });

  it('handles tool execution failure', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_fail', name: 'fail', arguments: '{}' }]),
      finalResponse('Recovered from failure'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Fail' });

    expect(result.response).toBe('Recovered from failure');
    expect(result.finishReason).toBe('completed');
  });

  it('returns error result when LLM fails', async () => {
    const llm = createMockLLM([]);
    (llm.chat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM down'));
    const agent = createAgent(db, llm);
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Hi' });

    expect(result.finishReason).toBe('error');
    expect(result.iterations).toBe(1);
  });

  it('stops at iteration limit', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_loop1', name: 'echo', arguments: '{"message":"loop"}' }]),
      toolCallResponse([{ id: 'call_loop2', name: 'echo', arguments: '{"message":"loop"}' }]),
    ]);
    const agent = createAgent(db, llm, '2');
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Loop' });

    expect(result.finishReason).toBe('iteration_limit');
    expect(result.iterations).toBe(2);
  });


  it('respects abort signal', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_1', name: 'echo', arguments: '{"message":"x"}' }]),
      finalResponse('Never'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const controller = new AbortController();
    controller.abort();

    await expect(
      agent.run({ userId: user.id, message: 'Abort', abortSignal: controller.signal }),
    ).rejects.toThrow(AgentCancelledError);
  });

  it('persists session', async () => {
    const llm = createMockLLM([finalResponse('OK')]);
    const agent = createAgent(db, llm);
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Hi' });

    const session = db.repositories.sessions.findById(result.sessionId);
    expect(session).toBeDefined();
    expect(session?.user_id).toBe(user.id);
  });

  it('persists user and assistant messages', async () => {
    const llm = createMockLLM([finalResponse('Reply')]);
    const agent = createAgent(db, llm);
    const user = await createUser(db);

    await agent.run({ userId: user.id, message: 'Question' });

    const messages = db.repositories.messages.findAll();
    expect(messages.some((m) => m.role === 'user' && m.content === 'Question')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant' && m.content === 'Reply')).toBe(true);
  });

  it('persists tool calls and results', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_1', name: 'echo', arguments: '{"message":"persist"}' }]),
      finalResponse('Done'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    await agent.run({ userId: user.id, message: 'Persist' });

    const calls = db.repositories.toolCalls.findAll();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].tool_name).toBe('echo');
    expect(calls[0].result).toBe('persist');
  });

  it('aggregates usage across multiple LLM calls', async () => {
    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_1', name: 'echo', arguments: '{"message":"u"}' }]),
      finalResponse('Done'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    const result = await agent.run({ userId: user.id, message: 'Usage' });

    expect(result.usage?.promptTokens).toBe(2);
    expect(result.usage?.completionTokens).toBe(2);
    expect(result.usage?.totalTokens).toBe(4);
  });

  it('loads SOUL.md into system prompt', async () => {
    const llm = createMockLLM([finalResponse('OK')]);
    const agent = createAgent(db, llm);
    const user = await createUser(db);

    await agent.run({ userId: user.id, message: 'Hi' });

    const calls = (llm.chat as ReturnType<typeof vi.fn>).mock.calls;
    const messages = calls[0][0].messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('autonomous');
  });

  it('preserves context role ordering with tool calls', async () => {
    const toolCall = { id: 'call_order', name: 'echo', arguments: '{"message":"order"}' };
    const llm = createMockLLM([
      toolCallResponse([toolCall]),
      finalResponse('Done'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    await agent.run({ userId: user.id, message: 'Order' });

    const calls = (llm.chat as ReturnType<typeof vi.fn>).mock.calls;
    const secondMessages = calls[1][0].messages as Array<{ role: string; tool_call_id?: string; tool_calls?: unknown }>;
    expect(secondMessages[0].role).toBe('system');
    expect(secondMessages[1].role).toBe('user');
    expect(secondMessages[2].role).toBe('assistant');
    expect(secondMessages[2].tool_calls).toBeDefined();
    expect(secondMessages[3].role).toBe('tool');
    expect(secondMessages[3].tool_call_id).toBe('call_order');
  });

  it('links tool result to correct tool_call_id', async () => {
    const toolCall = { id: 'call_link', name: 'echo', arguments: '{"message":"link"}' };
    const llm = createMockLLM([
      toolCallResponse([toolCall]),
      finalResponse('Done'),
    ]);
    const agent = createAgent(db, llm);
    createTestTools(agent.getToolRegistry());
    const user = await createUser(db);

    await agent.run({ userId: user.id, message: 'Link' });

    const calls = (llm.chat as ReturnType<typeof vi.fn>).mock.calls;
    const secondMessages = calls[1][0].messages as Array<{ role: string; tool_call_id?: string }>;
    const toolMessage = secondMessages.find((m) => m.role === 'tool');
    expect(toolMessage?.tool_call_id).toBe('call_link');
  });
});


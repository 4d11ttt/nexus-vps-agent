import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import pino from 'pino';
import { AgentCore } from '../../src/agent/AgentCore.js';
import { ToolRegistry } from '../../src/agent/ToolRegistry.js';
import { loadConfig } from '../../src/config.js';
import { createTestDatabase } from '../database/helpers.js';
import type { Database } from '../../src/database/Database.js';
import type { ChatResponse, LLMProvider, ToolCall } from '../../src/llm/types.js';

function createConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: './data/agent.db',
    AGENT_MAX_ITERATIONS: '5',
  });
}

function createLogger() {
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

describe('AgentCore autonomous dependency check', () => {
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

  it('checks whether nginx is installed and can decide to install if missing', async () => {
    const registry = new ToolRegistry();
    // Mock the conceptual system/package-manager check tool.
    registry.register({
      name: 'nginx_status',
      description: 'Check whether nginx is installed on the VPS.',
      parameters: z.object({}),
      parameterSchema: { type: 'object', properties: {} },
      execute: async () => JSON.stringify({ installed: false, package: 'nginx' }),
    });

    const llm = createMockLLM([
      toolCallResponse([{ id: 'call_1', name: 'nginx_status', arguments: '{}' }]),
      finalResponse('nginx is not installed. I can install it with apt if you confirm.'),
    ]);

    const agent = new AgentCore({
      llm,
      db,
      config: createConfig(),
      logger: createLogger(),
      registry,
    });

    const user = await Promise.resolve(
      db.repositories.users.create({
        telegram_user_id: 'autonomous-test',
        language: 'id',
        status: 'active',
      }),
    );

    const result = await agent.run({ userId: user.id, message: 'Check whether nginx is installed.' });

    expect(result.finishReason).toBe('completed');
    expect(result.response).toContain('not installed');
    expect(result.toolCalls).toBe(1);

    const calls = db.repositories.toolCalls.findBySessionId(result.sessionId);
    expect(calls.length).toBe(1);
    expect(calls[0].tool_name).toBe('nginx_status');

    const llmCalls = (llm.chat as ReturnType<typeof vi.fn>).mock.calls;
    expect(llmCalls.length).toBe(2);
    const secondRequest = llmCalls[1][0];
    expect(secondRequest.messages.some((m: { role: string; tool_call_id?: string }) => m.role === 'tool' && m.tool_call_id === 'call_1')).toBe(true);
  });
});

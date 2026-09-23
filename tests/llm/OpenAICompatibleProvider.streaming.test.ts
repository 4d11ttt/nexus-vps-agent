import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../src/llm/OpenAICompatibleProvider.js';
import { loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import type { ChatStreamChunk } from '../../src/llm/types.js';

function createConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: './data/agent.db',
    LLM_API_BASE: 'https://api.test.com/v1',
    LLM_API_KEY: 'test-api-key',
    LLM_MODEL: 'test-model',
    LLM_TIMEOUT_MS: '5000',
    LLM_MAX_RETRIES: '0',
    ...overrides,
  });
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as import('pino').Logger;
}

function createProvider(overrides: NodeJS.ProcessEnv = {}) {
  const config = createConfig(overrides);
  return new OpenAICompatibleProvider(config, createLogger());
}

function sseResponse(events: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenAICompatibleProvider streaming', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams content and finish reason', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const chunks: string[] = [];
    for await (const chunk of provider.streamChat({ messages: [] })) {
      chunks.push(chunk.content);
    }

    expect(chunks[chunks.length - 1]).toBe('Hello world');
  });

  it('accumulates partial tool-call arguments across chunks', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cm"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"d\\":\\"ls\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    let final: ChatStreamChunk = { content: '', toolCalls: [] };
    for await (const chunk of provider.streamChat({ messages: [] })) {
      final = chunk;
    }

    expect(final.toolCalls).toHaveLength(1);
    expect(final.toolCalls[0].id).toBe('call_1');
    expect(final.toolCalls[0].name).toBe('shell');
    expect(final.toolCalls[0].arguments).toBe('{"cmd":"ls"}');
    expect(final.finishReason).toBe('tool_calls');
  });

  it('sends stream=true in request body', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseResponse(['data: {"choices":[]}\n\n', 'data: [DONE]\n\n']),
    );

    for await (const _ of provider.streamChat({ messages: [] })) {
      // consume
    }

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const init = calls[0][1] as RequestInit;
    const body = JSON.parse((init.body as string) ?? '{}');
    expect(body.stream).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../src/llm/OpenAICompatibleProvider.js';
import {
  LLMInvalidRequestError,
  LLMAuthenticationError,
  LLMRateLimitError,
  LLMTimeoutError,
  LLMServerError,
  LLMError,
} from '../../src/llm/errors.js';
import { loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';

function createConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: './data/agent.db',
    LLM_API_BASE: 'https://api.test.com/v1',
    LLM_API_KEY: 'test-api-key',
    LLM_MODEL: 'test-model',
    LLM_TIMEOUT_MS: '5000',
    LLM_MAX_RETRIES: '1',
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

function jsonResponse(body: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function lastFetchCall(): { url: string; init: RequestInit } {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1];
  return { url: last[0] as string, init: last[1] as RequestInit };
}

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws if required config is missing', () => {
    expect(() => createProvider({ LLM_API_KEY: undefined })).toThrow(LLMInvalidRequestError);
  });

  it('returns a successful completion', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const response = await provider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(response.message.content).toBe('Hello!');
    expect(response.finishReason).toBe('stop');
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('sends system and user messages', async () => {
    const provider = createProvider();
    await provider.chat({
      messages: [
        { role: 'system', content: 'You are a test assistant.' },
        { role: 'user', content: 'Hello' },
      ],
    });

    const { init } = lastFetchCall();
    const body = JSON.parse((init.body as string) ?? '{}');
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a test assistant.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('sends tool definitions', async () => {
    const provider = createProvider();
    await provider.chat({
      messages: [{ role: 'user', content: 'Run command' }],
      tools: [{ name: 'shell', description: 'Run shell command', parameters: { type: 'object', properties: {} } }],
    });

    const { init } = lastFetchCall();
    const body = JSON.parse((init.body as string) ?? '{}');
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('shell');
  });

  it('parses tool calls from response', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'call_1', function: { name: 'shell', arguments: '{"cmd":"ls"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );

    const response = await provider.chat({ messages: [{ role: 'user', content: 'List files' }] });
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]).toEqual({ id: 'call_1', name: 'shell', arguments: '{"cmd":"ls"}' });
    expect(response.finishReason).toBe('tool_calls');
  });

  it('keeps malformed tool arguments as raw string', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: { role: 'assistant', tool_calls: [{ id: 'call_bad', function: { name: 'shell', arguments: 'not json' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );

    const response = await provider.chat({ messages: [] });
    expect(response.toolCalls[0].arguments).toBe('not json');
  });

  it('throws LLMServerError on malformed JSON response', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMServerError);
  });

  it('throws LLMInvalidRequestError on HTTP 400', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, 400));
    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMInvalidRequestError);
  });

  it('throws LLMAuthenticationError on HTTP 401', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMAuthenticationError);
  });

  it('throws LLMTimeoutError on HTTP 408', async () => {
    const provider = createProvider({ LLM_MAX_RETRIES: '0' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ error: 'timeout' }, 408));
    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMTimeoutError);
  });

  it('throws LLMRateLimitError on HTTP 429', async () => {
    const provider = createProvider({ LLM_MAX_RETRIES: '0' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429));
    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMRateLimitError);
  });

  it('throws LLMServerError on HTTP 500', async () => {
    const provider = createProvider({ LLM_MAX_RETRIES: '0' });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ error: 'server error' }, 500));
    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMServerError);
  });

  it('throws LLMTimeoutError when internal timeout fires', async () => {
    const provider = createProvider({ LLM_TIMEOUT_MS: '1', LLM_MAX_RETRIES: '0' });
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce((_url: unknown, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal!;
        signal.addEventListener('abort', () => reject(new DOMException('Aborted by timeout', 'AbortError')), { once: true });
      });
    });

    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMTimeoutError);
  });

  it('retries on network failure and succeeds', async () => {
    const provider = createProvider({ LLM_MAX_RETRIES: '1' });
    (fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }));

    const response = await provider.chat({ messages: [] });
    expect(response.message.content).toBe('OK');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after max retries exceeded', async () => {
    const provider = createProvider({ LLM_MAX_RETRIES: '1' });
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('network failed'));

    await expect(provider.chat({ messages: [] })).rejects.toThrow(LLMServerError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns undefined usage when omitted by API', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }] }),
    );

    const response = await provider.chat({ messages: [] });
    expect(response.usage).toBeUndefined();
  });

  it('does not leak API key into logs', async () => {
    const logger = createLogger();
    const config = createConfig();
    const provider = new OpenAICompatibleProvider(config, logger);

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const logged = [
      ...(logger.debug as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
    ];
    for (const call of logged) {
      expect(JSON.stringify(call)).not.toContain('test-api-key');
    }

    const { init } = lastFetchCall();
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-api-key');
  });

  it('respects external abort signal', async () => {
    const provider = createProvider({ LLM_MAX_RETRIES: '0' });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.chat({ messages: [], abortSignal: controller.signal })).rejects.toThrow(LLMError);
  });

  it('handles empty choices gracefully', async () => {
    const provider = createProvider();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ choices: [] }));

    const response = await provider.chat({ messages: [] });
    expect(response.message.content).toBe('');
    expect(response.toolCalls).toHaveLength(0);
  });

  it('uses configured model and base URL', async () => {
    const provider = createProvider({
      LLM_API_BASE: 'https://custom.example.com/openai',
      LLM_MODEL: 'custom-model',
    });
    await provider.chat({ messages: [] });

    const { url, init } = lastFetchCall();
    expect(url).toBe('https://custom.example.com/openai/chat/completions');
    expect(JSON.parse((init.body as string) ?? '{}').model).toBe('custom-model');
  });
});


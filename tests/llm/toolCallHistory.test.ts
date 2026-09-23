import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../src/llm/OpenAICompatibleProvider.js';
import { loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import type { Message } from '../../src/llm/types.js';

function createConfig(): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LLM_API_BASE: 'https://api.test.com/v1',
    LLM_API_KEY: 'test-api-key',
    LLM_MODEL: 'test-model',
    LLM_MAX_RETRIES: '0',
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Inspect the actual JSON request body sent to the mocked fetch. */
function lastFetchBody(): any {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  const init = calls[calls.length - 1][1] as RequestInit;
  return JSON.parse((init.body as string) ?? '{}');
}

describe('OpenAICompatibleProvider tool-call history', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a plain user message and receives a final response', async () => {
    const provider = new OpenAICompatibleProvider(createConfig(), createLogger());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      }),
    );

    const response = await provider.chat({ messages: [{ role: 'user', content: 'hello' }] });

    expect(response.message.content).toBe('done');
    expect(response.toolCalls).toHaveLength(0);
  });

  it('preserves assistant tool_calls in the request body', async () => {
    const provider = new OpenAICompatibleProvider(createConfig(), createLogger());

    const messages: Message[] = [
      { role: 'user', content: 'What is the hostname?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'system_hostname', arguments: '{}' }],
      },
      { role: 'tool', content: '{"hostname":"myserver"}', tool_call_id: 'call_1' },
    ];

    await provider.chat({ messages });

    const body = lastFetchBody();
    const assistant = body.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBeNull();
    expect(assistant.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'system_hostname', arguments: '{}' },
      },
    ]);
  });

  it('preserves the tool result with a matching tool_call_id', async () => {
    const provider = new OpenAICompatibleProvider(createConfig(), createLogger());

    await provider.chat({
      messages: [
        { role: 'user', content: 'What is the hostname?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', name: 'system_hostname', arguments: '{}' }],
        },
        { role: 'tool', content: '{"hostname":"myserver"}', tool_call_id: 'call_1' },
      ],
    });

    const body = lastFetchBody();
    expect(body.messages[2]).toEqual({
      role: 'tool',
      content: '{"hostname":"myserver"}',
      tool_call_id: 'call_1',
    });
  });

  it('preserves multiple tool calls in one assistant message', async () => {
    const provider = new OpenAICompatibleProvider(createConfig(), createLogger());

    await provider.chat({
      messages: [
        { role: 'user', content: 'run two checks' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_a', name: 'system_hostname', arguments: '{}' },
            { id: 'call_b', name: 'system_uptime', arguments: '{}' },
          ],
        },
        { role: 'tool', content: 'a-result', tool_call_id: 'call_a' },
        { role: 'tool', content: 'b-result', tool_call_id: 'call_b' },
      ],
    });

    const body = lastFetchBody();
    const assistant = body.messages[1];
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls[0]).toEqual({
      id: 'call_a',
      type: 'function',
      function: { name: 'system_hostname', arguments: '{}' },
    });
    expect(assistant.tool_calls[1]).toEqual({
      id: 'call_b',
      type: 'function',
      function: { name: 'system_uptime', arguments: '{}' },
    });
  });

  it('leaves assistant messages without tool calls unchanged', async () => {
    const provider = new OpenAICompatibleProvider(createConfig(), createLogger());

    await provider.chat({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello there' },
      ],
    });

    const body = lastFetchBody();
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'hello there' });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelCatalog } from '../../src/llm/ModelCatalog.js';
import { LLMRuntimeConfig } from '../../src/llm/LLMRuntimeConfig.js';
import type { Config } from '../../src/config.js';

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
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: 'fake-token',
    TELEGRAM_ALLOWED_USER_IDS: [1],
    LLM_API_BASE: 'https://api.example.com/v1',
    LLM_API_KEY: 'fake-key',
    LLM_MODEL: 'default-model',
    LLM_SECRETS_PATH: './data/test-catalog-secrets.json',
    ...overrides,
  } as Config;
}

function makeCatalog(overrides: Partial<Config> = {}): ModelCatalog {
  return new ModelCatalog({
    runtimeConfig: new LLMRuntimeConfig(makeConfig(overrides)),
    logger: makeLogger(),
  });
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

function fakeResponse(body: unknown, status = 200, ok = true): Response {
  return {
    ok,
    status,
    clone: () => fakeResponse(body, status, ok),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('ModelCatalog', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      fakeResponse({
        data: [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b' },
          { id: '' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and normalizes models from /v1/models', async () => {
    const catalog = makeCatalog();
    const models = await catalog.listModels();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer fake-key' }),
      }),
    );
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('model-a');
    expect(models[0].name).toBe('Model A');
    expect(models[1].id).toBe('model-b');
  });

  it('avoids /v1/v1 duplication when base already ends with /v1', async () => {
    const catalog = makeCatalog({ LLM_API_BASE: 'https://api.example.com/openai/v1/' });
    await catalog.listModels();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/openai/v1/models',
      expect.anything(),
    );
  });

  it('caches results and uses the cache within TTL', async () => {
    const catalog = makeCatalog();
    await catalog.listModels();
    await catalog.listModels();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('forces refresh when requested', async () => {
    const catalog = makeCatalog();
    await catalog.listModels();
    await catalog.listModels({ refresh: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns a safe error on API failure', async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ error: 'bad request' }, 400, false));
    const catalog = makeCatalog();
    await expect(catalog.listModels()).rejects.toThrow('Failed to fetch models (400)');
  });

  it('returns a safe error on network/timeout failure', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const catalog = makeCatalog();
    await expect(catalog.listModels()).rejects.toThrow('network down');
  });

  it('testConnection returns ok=true on success', async () => {
    const catalog = makeCatalog();
    const status = await catalog.testConnection();
    expect(status.ok).toBe(true);
    expect(status.status).toBe(200);
  });

  it('testConnection returns ok=false on failure without throwing', async () => {
    fetchSpy.mockRejectedValue(new Error('timeout'));
    const catalog = makeCatalog();
    const status = await catalog.testConnection();
    expect(status.ok).toBe(false);
    expect(status.error).toContain('timeout');
  });
});


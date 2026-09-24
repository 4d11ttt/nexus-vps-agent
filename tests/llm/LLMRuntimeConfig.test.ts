import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { LLMRuntimeConfig, normalizeBaseUrl } from '../../src/llm/LLMRuntimeConfig.js';
import type { Config } from '../../src/config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: './data/agent.db',
    LLM_API_BASE: 'https://api.example.com/v1',
    LLM_API_KEY: 'secret-key',
    LLM_MODEL: 'default-model',
    LLM_SECRETS_PATH: './data/test-runtime-secrets.json',
    ...overrides,
  } as Config;
}

describe('normalizeBaseUrl', () => {
  it('trims trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });

  it('prevents /v1/v1 duplication', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/v1')).toBe('https://api.example.com/v1');
  });

  it('rejects empty URLs', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow('empty');
  });

  it('rejects invalid URLs', () => {
    expect(() => normalizeBaseUrl('not a url')).toThrow();
  });
});

describe('LLMRuntimeConfig', () => {
  beforeEach(() => {
    try {
      rmSync('./data/test-runtime-secrets.json');
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      rmSync('./data/test-runtime-secrets.json');
    } catch {
      // ignore
    }
  });

  it('loads initial values from env config', () => {
    const config = makeConfig();
    const runtime = new LLMRuntimeConfig(config);
    expect(runtime.getApiBase()).toBe('https://api.example.com/v1');
    expect(runtime.getApiKey()).toBe('secret-key');
    expect(runtime.getDefaultModel()).toBe('default-model');
  });

  it('masks the API key', () => {
    const runtime = new LLMRuntimeConfig(makeConfig());
    expect(runtime.maskApiKey()).toBe('••••••••');
  });

  it('updates base URL and persists it', () => {
    const runtime = new LLMRuntimeConfig(makeConfig());
    runtime.setApiBase('https://new.example.com/v1/');
    expect(runtime.getApiBase()).toBe('https://new.example.com/v1');

    const reloaded = new LLMRuntimeConfig(makeConfig());
    expect(reloaded.getApiBase()).toBe('https://new.example.com/v1');
  });

  it('updates API key and persists it securely', () => {
    const runtime = new LLMRuntimeConfig(makeConfig());
    runtime.setApiKey('new-secret');
    expect(runtime.getApiKey()).toBe('new-secret');

    const reloaded = new LLMRuntimeConfig(makeConfig());
    expect(reloaded.getApiKey()).toBe('new-secret');
  });

  it('persists values to the configured secrets file', () => {
    const runtime = new LLMRuntimeConfig(makeConfig());
    runtime.setApiBase('https://persist.example.com/v1');
    runtime.setApiKey('persisted-key');
    runtime.setDefaultModel('persisted-model');

    expect(existsSync('./data/test-runtime-secrets.json')).toBe(true);

    const reloaded = new LLMRuntimeConfig(makeConfig());
    expect(reloaded.getApiBase()).toBe('https://persist.example.com/v1');
    expect(reloaded.getApiKey()).toBe('persisted-key');
    expect(reloaded.getDefaultModel()).toBe('persisted-model');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('applies safe defaults when no relevant env vars are set', () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('reads valid environment overrides', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
    });
    expect(config.NODE_ENV).toBe('production');
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('throws a ConfigError for invalid LOG_LEVEL', () => {
    expect(() =>
      loadConfig({ LOG_LEVEL: 'verbose' }),
    ).toThrow('Invalid configuration');
  });

  it('applies Phase 5 tool defaults', () => {
    const config = loadConfig({});
    expect(config.TOOL_SHELL_TIMEOUT_MS).toBe(300_000);
    expect(config.TOOL_MAX_OUTPUT_BYTES).toBe(1_048_576);
  });

  it('reads Phase 5 tool overrides', () => {
    const config = loadConfig({
      TOOL_SHELL_TIMEOUT_MS: '60000',
      TOOL_MAX_OUTPUT_BYTES: '1024',
    });
    expect(config.TOOL_SHELL_TIMEOUT_MS).toBe(60_000);
    expect(config.TOOL_MAX_OUTPUT_BYTES).toBe(1024);
  });

  it('applies Telegram defaults when Telegram is disabled', () => {
    const config = loadConfig({});
    expect(config.TELEGRAM_ENABLED).toBe(false);
    expect(config.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(config.TELEGRAM_ALLOWED_USER_IDS).toBeUndefined();
  });

  it('parses Telegram enabled configuration', () => {
    const config = loadConfig({
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_ALLOWED_USER_IDS: ' 123 , 456 ',
    });
    expect(config.TELEGRAM_ENABLED).toBe(true);
    expect(config.TELEGRAM_BOT_TOKEN).toBe('123:abc');
    expect(config.TELEGRAM_ALLOWED_USER_IDS).toEqual([123, 456]);
  });

  it('throws when Telegram is enabled without a bot token', () => {
    expect(() =>
      loadConfig({
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_ALLOWED_USER_IDS: '123',
      }),
    ).toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('throws when Telegram is enabled without allowed user IDs', () => {
    expect(() =>
      loadConfig({
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123:abc',
      }),
    ).toThrow('TELEGRAM_ALLOWED_USER_IDS');
  });

  it('throws for malformed allowed user IDs', () => {
    expect(() =>
      loadConfig({
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123:abc',
        TELEGRAM_ALLOWED_USER_IDS: '123,abc',
      }),
    ).toThrow('TELEGRAM_ALLOWED_USER_IDS');
  });

  it('throws for empty allowed user IDs when enabled', () => {
    expect(() =>
      loadConfig({
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123:abc',
        TELEGRAM_ALLOWED_USER_IDS: '   ',
      }),
    ).toThrow('TELEGRAM_ALLOWED_USER_IDS');
  });

  it('throws a ConfigError for invalid NODE_ENV', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'staging' }),
    ).toThrow('Invalid configuration');
  });
});

import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Config } from '../config.js';

interface SavedRuntimeConfig {
  apiBase?: string;
  apiKey?: string;
  defaultModel?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize an OpenAI-compatible base URL.
 *
 * - Trims trailing slashes.
 * - Prevents accidental `/v1/v1` duplication.
 * - Validates the URL shape before returning.
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    throw new Error('Base URL cannot be empty');
  }

  let normalized = trimmed;
  while (normalized.endsWith('/v1/v1')) {
    normalized = normalized.slice(0, -3); // remove the duplicated /v1
  }

  // Validate the final URL.
  new URL(normalized);
  return normalized;
}

/**
 * Runtime LLM provider configuration.
 *
 * Centralizes the values used by the active OpenAI-compatible provider:
 * base URL, API key, and default model. Secrets are persisted to a dedicated
 * root-owned file (mode 0600), never to SQLite or logs. Base URL and model
 * are stored alongside the key in the same protected file because they are
 * sensitive operational settings in this deployment.
 */
export class LLMRuntimeConfig {
  private apiBase: string;
  private apiKey: string;
  private defaultModel: string;
  private readonly secretsPath: string;

  constructor(private readonly config: Config) {
    this.secretsPath = this.resolveSecretsPath();
    const saved = this.loadSaved();

    this.apiBase = saved.apiBase ?? config.LLM_API_BASE ?? '';
    this.apiKey = saved.apiKey ?? config.LLM_API_KEY ?? '';
    this.defaultModel = saved.defaultModel ?? config.LLM_MODEL ?? '';
  }

  getApiBase(): string {
    return this.apiBase;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  maskApiKey(): string {
    return this.apiKey ? '••••••••' : 'not set';
  }

  /**
   * Update the base URL after normalizing it.
   */
  setApiBase(url: string): void {
    this.apiBase = normalizeBaseUrl(url);
    this.save();
  }

  /**
   * Update the API key. The value is persisted securely and never logged.
   */
  setApiKey(key: string): void {
    this.apiKey = key.trim();
    this.save();
  }

  /**
   * Update the default model used when no per-request override is active.
   */
  setDefaultModel(model: string): void {
    this.defaultModel = model.trim();
    this.save();
  }

  private resolveSecretsPath(): string {
    if (this.config.LLM_SECRETS_PATH) {
      return resolve(this.config.LLM_SECRETS_PATH);
    }
    const dbDir = dirname(resolve(this.config.DATABASE_PATH));
    return join(dbDir, 'secrets.json');
  }

  private loadSaved(): SavedRuntimeConfig {
    try {
      const raw = readFileSync(this.secretsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) return {};
      const saved: SavedRuntimeConfig = {};
      if (typeof parsed.apiBase === 'string') saved.apiBase = parsed.apiBase;
      if (typeof parsed.apiKey === 'string') saved.apiKey = parsed.apiKey;
      if (typeof parsed.defaultModel === 'string') saved.defaultModel = parsed.defaultModel;
      return saved;
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.secretsPath), { recursive: true });
    } catch {
      // ignore
    }

    const payload = JSON.stringify({
      apiBase: this.apiBase,
      apiKey: this.apiKey,
      defaultModel: this.defaultModel,
    });

    const tempPath = `${this.secretsPath}.tmp`;
    writeFileSync(tempPath, payload, { mode: 0o600 });
    renameSync(tempPath, this.secretsPath);
    try {
      chmodSync(this.secretsPath, 0o600);
    } catch {
      // Best-effort: permissions may not be adjustable on every platform.
    }
  }
}

import type { Logger } from 'pino';
import type { Config } from '../config.js';

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface ModelCatalogDeps {
  config: Config;
  logger: Logger;
}

export interface ConnectionStatus {
  ok: boolean;
  error?: string;
  status?: number;
}

interface ModelsResponse {
  data?: Array<{ id?: string; name?: string }>;
}

/**
 * Generic OpenAI-compatible model catalog.
 *
 * Fetches the /models endpoint for the configured provider, caches the result
 * with a short TTL, and supports forced refresh. API keys are used for
 * requests but never logged or exposed.
 */
export class ModelCatalog {
  private cache: { models: ModelInfo[]; fetchedAt: number } | null = null;

  constructor(private readonly deps: ModelCatalogDeps) {}

  /**
   * Return the available models, using the cache unless forced or expired.
   */
  async listModels(options: { refresh?: boolean } = {}): Promise<ModelInfo[]> {
    if (!options.refresh && this.cache && !this.isExpired(this.cache.fetchedAt)) {
      return this.cache.models;
    }

    const models = await this.fetchModels();
    this.cache = { models, fetchedAt: Date.now() };
    return models;
  }

  /**
   * Test connectivity to the provider by fetching the models endpoint.
   * Does not throw on failure; returns a safe status object.
   */
  async testConnection(): Promise<ConnectionStatus> {
    try {
      const response = await this.fetchModelsRaw();
      if (response.ok) {
        return { ok: true, status: response.status };
      }
      const body = await this.safeReadError(response);
      return {
        ok: false,
        status: response.status,
        error: `Provider returned ${response.status}${body ? ` (${body.slice(0, 120)})` : ''}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  private isExpired(fetchedAt: number): boolean {
    return Date.now() - fetchedAt > MODELS_CACHE_TTL_MS;
  }

  private async fetchModels(): Promise<ModelInfo[]> {
    const response = await this.fetchModelsRaw();

    if (!response.ok) {
      const body = await this.safeReadError(response);
      throw new Error(
        `Failed to fetch models (${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
      );
    }

    const raw = (await response.json()) as ModelsResponse;
    const data = Array.isArray(raw.data) ? raw.data : [];

    const models: ModelInfo[] = [];
    for (const item of data) {
      const id = typeof item.id === 'string' ? item.id : undefined;
      if (!id) continue;
      const model: ModelInfo = { id };
      if (typeof item.name === 'string' && item.name !== id) {
        model.name = item.name;
      }
      models.push(model);
    }

    return models.sort((a, b) => a.id.localeCompare(b.id));
  }

  private fetchModelsRaw(): Promise<Response> {
    const url = this.buildModelsUrl();
    const apiKey = this.deps.config.LLM_API_KEY;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);

    return fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    })
      .finally(() => clearTimeout(timeoutId))
      .catch((error) => {
        if (controller.signal.reason === 'timeout') {
          throw new Error('Model catalog request timed out');
        }
        throw error;
      });
  }

  private buildModelsUrl(): string {
    const base = (this.deps.config.LLM_API_BASE ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('LLM_API_BASE is not configured');
    }
    if (base.endsWith('/v1')) {
      return `${base}/models`;
    }
    return `${base}/v1/models`;
  }

  private safeReadError(response: Response): Promise<string> {
    return response
      .clone()
      .text()
      .catch(() => '');
  }
}

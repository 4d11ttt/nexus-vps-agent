import { AsyncLocalStorage } from 'node:async_hooks';

interface ModelContextStore {
  model: string;
}

const modelContext = new AsyncLocalStorage<ModelContextStore>();

/**
 * Run a function with a per-request model override.
 *
 * The OpenAI-compatible provider reads this value when building request bodies,
 * allowing different users (or scheduled jobs) to use different models without
 * changing the global configuration.
 */
export function withModelOverride<T>(model: string, fn: () => Promise<T>): Promise<T> {
  return modelContext.run({ model }, fn);
}

/**
 * Get the model override for the current async context, if any.
 */
export function getModelOverride(): string | undefined {
  return modelContext.getStore()?.model;
}

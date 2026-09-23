import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';

const DEFAULT_PROMPT =
  'You are NEXUS VPS Agent, a helpful autonomous assistant operating on a Debian VPS. Follow instructions safely and concisely.';

export function loadSystemPrompt(
  logger: Logger,
  customPath?: string,
): string {
  const path = customPath ? resolve(customPath) : resolve('workspace', 'SOUL.md');
  try {
    return readFileSync(path, 'utf-8');
  } catch (error) {
    logger.warn({ path, error }, 'SOUL.md not found, using fallback system prompt');
    return DEFAULT_PROMPT;
  }
}

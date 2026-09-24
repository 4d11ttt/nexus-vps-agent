import { z } from 'zod';
import { ConfigError } from './errors.js';

/**
 * Runtime configuration schema.
 *
 * All values are read from environment variables and validated with Zod.
 * Secrets must be supplied via environment variables, never committed to source.
 */
const toNumber = (val: unknown): unknown =>
  typeof val === 'string' ? Number(val) : val;

const toBoolean = (val: unknown): unknown =>
  typeof val === 'string' ? val === 'true' : val;

const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  // Application environment. Falls back to NODE_ENV when not set explicitly.
  APP_ENV: z.enum(['development', 'production', 'test']).optional(),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  DATABASE_PATH: z.string().default('./data/agent.db'),
  WORKSPACE_DIR: z.string().default('workspace'),

  // LLM provider configuration (Phase 3)
  LLM_API_BASE: z.string().url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).optional(),
  LLM_SECRETS_PATH: z.string().optional(),
  LLM_TEMPERATURE: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().min(0).max(2).optional(),
  ),
  LLM_MAX_TOKENS: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().int().positive().optional(),
  ),
  LLM_CONTEXT_WINDOW: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().int().positive().optional(),
  ),
  LLM_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  LLM_TIMEOUT_MS: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().int().positive().default(120_000),
  ),
  LLM_MAX_RETRIES: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().int().nonnegative().default(3),
  ),

  // Agent configuration (Phase 4)
  AGENT_MAX_ITERATIONS: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().int().positive().default(50),
  ),

  // Tool configuration (Phase 5)
  TOOL_SHELL_TIMEOUT_MS: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().int().positive().default(300_000),
  ),
  TOOL_MAX_OUTPUT_BYTES: z.preprocess(
    (val) => (typeof val === 'string' ? Number(val) : val),
    z.number().int().positive().default(1_048_576),
  ),
  // Telegram configuration (Phase 6)
  TELEGRAM_ENABLED: z.preprocess(
    (val) => (typeof val === 'string' ? val === 'true' : val),
    z.boolean().default(false),
  ),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.preprocess(
    parseAllowedUserIds,
    z.array(z.number().int()).optional(),
  ),

  // Memory configuration (Phase 7)
  MEMORY_MAX_RESULTS: z.preprocess(toNumber, z.number().int().positive().default(5)),
  MEMORY_CONTEXT_LIMIT: z.preprocess(toNumber, z.number().int().positive().default(4_000)),

  // Scheduler configuration (Phase 8)
  SCHEDULER_ENABLED: z.preprocess(toBoolean, z.boolean().default(false)),
  SCHEDULER_POLL_INTERVAL_MS: z.preprocess(
    toNumber,
    z.number().int().positive().default(30_000),
  ),

  // MCP configuration (Phase 12, optional extension point)
  MCP_ENABLED: z.preprocess(toBoolean, z.boolean().default(false)),
});

export type Config = z.infer<typeof configSchema>;

function parseAllowedUserIds(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const ids = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
  if (ids.some((id) => Number.isNaN(id))) {
    throw new ConfigError(
      'TELEGRAM_ALLOWED_USER_IDS must be a comma-separated list of numeric Telegram user IDs',
    );
  }
  return ids.length === 0 ? undefined : ids;
}

function validateTelegramConfig(config: Config): void {
  if (!config.TELEGRAM_ENABLED) return;
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new ConfigError(
      'TELEGRAM_BOT_TOKEN is required when TELEGRAM_ENABLED is true',
    );
  }
  if (!config.TELEGRAM_ALLOWED_USER_IDS || config.TELEGRAM_ALLOWED_USER_IDS.length === 0) {
    throw new ConfigError(
      'TELEGRAM_ALLOWED_USER_IDS is required when TELEGRAM_ENABLED is true',
    );
  }
}

/**
 * Load environment variables from `.env` if the file exists.
 * Missing files are ignored so that production deployments can rely purely on
 * injected environment variables.
 */
export function loadEnvFile(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw new ConfigError(`Failed to load env file ${path}: ${err.message}`, {
        cause: error,
      });
    }
  }
}

/**
 * Parse and validate the provided environment object.
 *
 * Defaults to `process.env` so callers can also pass a custom object for tests.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    const config = configSchema.parse(env);
    validateTelegramConfig(config);
    return config;
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : error instanceof ConfigError
          ? error.message
          : String(error);
    throw new ConfigError(`Invalid configuration: ${message}`, { cause: error });
  }
}

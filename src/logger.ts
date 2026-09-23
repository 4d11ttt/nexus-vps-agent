import pino from 'pino';
import type { Config } from './config.js';

/**
 * Secret/privacy-sensitive fields that must never be logged.
 */
const REDACT_PATHS: string[] = [
  '*.token',
  '*.key',
  '*.secret',
  '*.password',
  '*.apiKey',
  '*.api_key',
  'authorization',
  'cookie',
];

/**
 * Create a structured Pino logger tied to the current configuration.
 *
 * - Uses the configured log level.
 * - Redacts common secret fields.
 * - Pretty-prints logs only in development to keep production output structured.
 */
export function createLogger(config: Config): pino.Logger {
  const isDev = (config.APP_ENV ?? config.NODE_ENV) === 'development';

  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
}

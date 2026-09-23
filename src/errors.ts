/**
 * Structured, typed errors used across the agent.
 *
 * Every operational error should carry:
 * - a human-readable message
 * - a stable machine-readable code
 * - a flag indicating whether it is expected/operational
 */

export type AgentErrorOptions = {
  code?: string;
  isOperational?: boolean;
  cause?: unknown;
};

export class AgentError extends Error {
  readonly code: string;
  isOperational: boolean;

  constructor(
    message: string,
    { code = 'AGENT_ERROR', isOperational = true, cause }: AgentErrorOptions = {},
  ) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.isOperational = isOperational;
  }
}

export class ConfigError extends AgentError {
  constructor(message: string, options: Omit<AgentErrorOptions, 'code'> = {}) {
    super(message, { code: 'CONFIG_ERROR', ...options });
  }
}

export class ValidationError extends AgentError {
  constructor(message: string, options: Omit<AgentErrorOptions, 'code'> = {}) {
    super(message, { code: 'VALIDATION_ERROR', ...options });
  }
}

export class InternalError extends AgentError {
  constructor(
    message: string,
    options: Omit<AgentErrorOptions, 'code' | 'isOperational'> = {},
  ) {
    super(message, { code: 'INTERNAL_ERROR', isOperational: false, ...options });
  }
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : String(error));
}


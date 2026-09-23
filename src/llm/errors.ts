import { AgentError } from '../errors.js';

export class LLMError extends AgentError {
  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { code: options.code ?? 'LLM_ERROR', cause: options.cause });
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(message = 'LLM request timed out', options: { cause?: unknown } = {}) {
    super(message, { code: 'LLM_TIMEOUT', cause: options.cause });
  }
}

export class LLMAuthenticationError extends LLMError {
  constructor(message = 'LLM authentication failed', options: { cause?: unknown } = {}) {
    super(message, { code: 'LLM_AUTHENTICATION', cause: options.cause });
  }
}

export class LLMRateLimitError extends LLMError {
  constructor(message = 'LLM rate limit hit', options: { cause?: unknown } = {}) {
    super(message, { code: 'LLM_RATE_LIMIT', cause: options.cause });
  }
}

export class LLMInvalidRequestError extends LLMError {
  constructor(message = 'LLM request invalid', options: { cause?: unknown } = {}) {
    super(message, { code: 'LLM_INVALID_REQUEST', cause: options.cause });
  }
}

export class LLMServerError extends LLMError {
  constructor(message = 'LLM server error', options: { cause?: unknown } = {}) {
    super(message, { code: 'LLM_SERVER_ERROR', cause: options.cause });
  }
}


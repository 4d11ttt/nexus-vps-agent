import { AgentError } from '../errors.js';

export class AgentLoopError extends AgentError {
  constructor(
    message: string,
    options: { code?: string; cause?: unknown } = {},
  ) {
    super(message, { code: options.code ?? 'AGENT_LOOP_ERROR', cause: options.cause });
  }
}

export class AgentIterationLimitError extends AgentLoopError {
  constructor(message = 'Agent iteration limit reached') {
    super(message, { code: 'AGENT_ITERATION_LIMIT' });
  }
}

export class AgentCancelledError extends AgentLoopError {
  constructor(message = 'Agent run cancelled') {
    super(message, { code: 'AGENT_CANCELLED' });
  }
}

export class ToolExecutionError extends AgentError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { code: 'TOOL_EXECUTION_ERROR', cause: options.cause });
  }
}

export class ToolValidationError extends AgentError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { code: 'TOOL_VALIDATION_ERROR', cause: options.cause });
  }
}

export class ToolNotFoundError extends AgentError {
  constructor(name: string) {
    super(`Tool not found: ${name}`, { code: 'TOOL_NOT_FOUND' });
  }
}


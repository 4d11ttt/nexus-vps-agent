import type { Logger } from 'pino';
import type { Config } from '../config.js';

/**
 * Context passed to every tool execution.
 *
 * Tools must receive everything they need through this object.
 * They do not get direct access to AgentCore.
 */
export interface ToolContext {
  logger: Logger;
  config: Config;
  userId: number;
  sessionId: number;
  abortSignal?: AbortSignal;
}

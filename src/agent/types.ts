import type { z } from 'zod';
import type { ToolContext } from '../tools/context.js';

export { ToolContext };

export interface AgentRunInput {
  userId: number;
  sessionId?: number;
  message: string;
  abortSignal?: AbortSignal;
}

export interface AgentResult {
  response: string;
  sessionId: number;
  iterations: number;
  toolCalls: number;
  usage: UsageAggregate | undefined;
  finishReason: AgentFinishReason;
}

export interface UsageAggregate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type AgentFinishReason =
  | 'completed'
  | 'iteration_limit'
  | 'aborted'
  | 'error';

export interface Tool<TParams = unknown> {
  name: string;
  description: string;
  parameters: z.ZodSchema<TParams>;
  /**
   * JSON Schema object describing the parameters. Used when registering the
   * tool with the LLM. If omitted, the tool is advertised with an empty
   * schema.
   */
  parameterSchema?: Record<string, unknown>;
  execute: (args: unknown, ctx: ToolContext) => Promise<string> | string;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}


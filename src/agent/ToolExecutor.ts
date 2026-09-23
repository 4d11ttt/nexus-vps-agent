import type { ToolCall } from '../llm/types.js';
import type { ToolContext } from '../tools/context.js';
import type { ToolResult } from './types.js';
import { ToolRegistry } from './ToolRegistry.js';

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(
    toolCall: ToolCall,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    const tool = this.registry.get(toolCall.name);

    if (!tool) {
      return this.makeResult(ctx, toolCall, start, false, '', `Tool not found: ${toolCall.name}`);
    }

    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(toolCall.arguments);
    } catch (error) {
      return this.makeResult(
        ctx,
        toolCall,
        start,
        false,
        '',
        `Malformed tool arguments: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      tool.parameters.parse(parsedArguments);
    } catch (error) {
      return this.makeResult(
        ctx,
        toolCall,
        start,
        false,
        '',
        `Invalid tool arguments: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const output = await tool.execute(parsedArguments, ctx);
      return this.makeResult(ctx, toolCall, start, true, output);
    } catch (error) {
      return this.makeResult(
        ctx,
        toolCall,
        start,
        false,
        '',
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private makeResult(
    ctx: ToolContext,
    toolCall: ToolCall,
    start: number,
    success: boolean,
    output: string,
    error?: string,
  ): ToolResult {
    const result: ToolResult = {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      success,
      output,
      durationMs: Date.now() - start,
    };
    if (error) result.error = error;

    ctx.logger.info(
      { tool: toolCall.name, success, durationMs: result.durationMs },
      'Tool executed',
    );
    return result;
  }
}


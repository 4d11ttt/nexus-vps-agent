import type { Logger } from 'pino';
import type { LLMProvider } from '../llm/types.js';
import type { Config } from '../config.js';
import type { Database } from '../database/Database.js';
import type { AuditService } from '../audit/AuditService.js';
import type {
  AgentResult,
  AgentRunInput,
  ToolContext,
} from './types.js';
import type { ToolExecutor } from './ToolExecutor.js';
import type { ToolRegistry } from './ToolRegistry.js';
import type { SessionManager } from './SessionManager.js';
import { ContextBuilder } from './ContextBuilder.js';
import { AgentCancelledError } from './errors.js';

export interface AgentLoopDeps {
  llm: LLMProvider;
  db: Database;
  registry: ToolRegistry;
  executor: ToolExecutor;
  sessionManager: SessionManager;
  config: Config;
  logger: Logger;
  systemPrompt: string;
  audit?: AuditService;
}

/** Maximum number of prior conversation turns injected into a new run. */
const HISTORY_LIMIT = 12;

export class AgentLoop {
  constructor(private readonly deps: AgentLoopDeps) {}

  async run(input: AgentRunInput, systemPromptOverride?: string): Promise<AgentResult> {
    const { llm, registry, executor, sessionManager, config, logger, systemPrompt } =
      this.deps;
    const effectiveSystemPrompt = systemPromptOverride ?? systemPrompt;
    const capability = llm.getCapabilities();

    const session = await sessionManager.getOrCreateSession({
      userId: input.userId,
      sessionId: input.sessionId,
      title: input.message.slice(0, 50),
    });

    const priorMessages = await sessionManager.loadMessages(session.id);
    await sessionManager.addUserMessage(session.id, input.message);

    const context = new ContextBuilder(
      effectiveSystemPrompt,
      capability.contextWindow,
      logger,
    );
    context.seedHistory(
      priorMessages
        .slice(-HISTORY_LIMIT)
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            m.role === 'user' || m.role === 'assistant',
        ),
    );
    context.addUserMessage(input.message);

    let iterations = 0;
    let totalToolCalls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let lastAssistantContent = '';

    const checkAbort = () => {
      if (input.abortSignal?.aborted) {
        throw new AgentCancelledError();
      }
    };

    while (iterations < config.AGENT_MAX_ITERATIONS) {
      checkAbort();
      iterations++;

      logger.info({ iteration: iterations, sessionId: session.id }, 'Agent iteration');

      let llmResponse;
      try {
        llmResponse = await llm.chat({
          messages: context.getMessages(),
          tools: registry.toToolDefinitions(),
          abortSignal: input.abortSignal,
        });
      } catch (error) {
        logger.error({ error }, 'LLM call failed');
        return {
          response: lastAssistantContent || 'Agent failed to get a response from the LLM.',
          sessionId: session.id,
          iterations,
          toolCalls: totalToolCalls,
          usage: this.makeUsage(promptTokens, completionTokens, totalTokens),
          finishReason: 'error',
        };
      }

      if (llmResponse.usage) {
        promptTokens += llmResponse.usage.promptTokens;
        completionTokens += llmResponse.usage.completionTokens;
        totalTokens += llmResponse.usage.totalTokens;
      }

      lastAssistantContent = llmResponse.message.content;

      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        await sessionManager.addAssistantMessage(session.id, lastAssistantContent);
        return {
          response: lastAssistantContent,
          sessionId: session.id,
          iterations,
          toolCalls: totalToolCalls,
          usage: this.makeUsage(promptTokens, completionTokens, totalTokens),
          finishReason: 'completed',
        };
      }

      totalToolCalls += llmResponse.toolCalls.length;
      context.addAssistantMessage(lastAssistantContent, llmResponse.toolCalls);

      const toolCtx: ToolContext = {
        userId: input.userId,
        sessionId: session.id,
        logger,
        config,
        abortSignal: input.abortSignal,
      };

      for (const tc of llmResponse.toolCalls) {
        checkAbort();
        logger.info({ tool: tc.name, sessionId: session.id }, 'Executing tool');
        const result = await executor.execute(tc, toolCtx);
        await sessionManager.addToolCall(session.id, tc, {
          output: result.output,
          error: result.error,
          durationMs: result.durationMs,
        });
        this.deps.audit?.record({
          userId: input.userId,
          eventType: result.success ? 'tool_invocation' : 'tool_failure',
          metadata: {
            tool: tc.name,
            sessionId: session.id,
            durationMs: result.durationMs,
          },
        });
        context.addToolResult(tc.id, result.success ? result.output : result.error || '');
      }
    }

    logger.warn({ sessionId: session.id, iterations }, 'Agent hit iteration limit');
    return {
      response:
        lastAssistantContent || 'Agent stopped because the maximum number of iterations was reached.',
      sessionId: session.id,
      iterations,
      toolCalls: totalToolCalls,
      usage: this.makeUsage(promptTokens, completionTokens, totalTokens),
      finishReason: 'iteration_limit',
    };
  }

  private makeUsage(
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
  ): AgentResult['usage'] {
    if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
      return undefined;
    }
    return { promptTokens, completionTokens, totalTokens };
  }
}


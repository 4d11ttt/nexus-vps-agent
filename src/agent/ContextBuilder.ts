import type { Logger } from 'pino';
import type { Message, ToolCall } from '../llm/types.js';

/** Rough token estimate: ~4 characters per token for typical prose. */
const CHARS_PER_TOKEN = 4;

/**
 * Builds the LLM message context for a single agent run.
 *
 * Context ordering:
 * 1. system prompt (always preserved)
 * 2. seeded conversation history (trimmed oldest-first when over budget)
 * 3. current turn: user request + assistant tool calls + tool results
 *
 * The current turn is never trimmed, so tool-call/tool-result pairs always
 * remain valid. History only contains plain user/assistant text messages, so
 * dropping it from the front can never split a tool-call block.
 */
export class ContextBuilder {
  private history: Message[] = [];
  private turn: Message[] = [];

  constructor(
    private readonly systemPrompt: string,
    private readonly contextWindow?: number,
    private readonly logger?: Logger,
  ) {}

  seedHistory(messages: Array<{ role: 'user' | 'assistant'; content: string }>): void {
    this.history = messages.map((m) => ({ role: m.role, content: m.content }));
  }

  addUserMessage(content: string): void {
    this.turn.push({ role: 'user', content });
  }

  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    this.turn.push({
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    });
  }

  addToolResult(toolCallId: string, content: string): void {
    this.turn.push({
      role: 'tool',
      content,
      tool_call_id: toolCallId,
    });
  }

  getMessages(): Message[] {
    const history = this.trimHistory();
    return [{ role: 'system', content: this.systemPrompt }, ...history, ...this.turn];
  }

  /**
   * True when the estimated context size approaches the configured window.
   */
  isNearLimit(): boolean {
    if (!this.contextWindow) return false;
    const ratio = this.estimateTotalTokens() / this.contextWindow;
    if (ratio > 0.8 && this.logger) {
      this.logger.warn(
        { ratio, estimatedTokens: this.estimateTotalTokens() },
        'Context approaching configured limit',
      );
    }
    return ratio > 0.9;
  }

  /**
   * Drop oldest history messages until the context fits within budget.
   * The system prompt and current turn are always preserved.
   */
  compactIfNeeded(): void {
    this.trimHistory();
  }

  private trimHistory(): Message[] {
    if (!this.contextWindow) return this.history;

    const budget = Math.floor(this.contextWindow * 0.9);
    const protectedTokens =
      this.estimateTokens(this.systemPrompt) + this.estimateMessages(this.turn);

    const history = [...this.history];
    let total = protectedTokens + this.estimateMessages(history);

    while (history.length > 0 && total > budget) {
      history.shift();
      total = protectedTokens + this.estimateMessages(history);
    }

    if (this.history.length !== history.length && this.logger) {
      this.logger.info(
        { dropped: this.history.length - history.length },
        'Trimmed conversation history to fit context window',
      );
    }

    return history;
  }

  private estimateTotalTokens(): number {
    return (
      this.estimateTokens(this.systemPrompt) +
      this.estimateMessages(this.history) +
      this.estimateMessages(this.turn)
    );
  }

  private estimateMessages(messages: Message[]): number {
    return messages.reduce(
      (sum, m) =>
        sum +
        this.estimateTokens(m.content) +
        (m.tool_calls ?? []).reduce(
          (acc, tc) => acc + this.estimateTokens(tc.arguments) + this.estimateTokens(tc.name),
          0,
        ),
      0,
    );
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}


import type { Logger } from 'pino';
import type { LLMProvider } from '../llm/types.js';
import type { Config } from '../config.js';
import type { Database } from '../database/Database.js';
import type { AuditService } from '../audit/AuditService.js';
import { AgentLoop } from './AgentLoop.js';
import { SessionManager } from './SessionManager.js';
import { ToolExecutor } from './ToolExecutor.js';
import { ToolRegistry } from './ToolRegistry.js';
import { loadSystemPrompt } from './systemPrompt.js';
import type { AgentResult, AgentRunInput } from './types.js';

export interface PromptSources {
  loadSoul(): string;
  loadUser(): string;
  loadMemoryFile(): string;
  buildMemoryContext(userId: number, query: string): string;
}

export interface SkillIndexSource {
  buildSkillIndex(): string;
}

export interface AgentCoreDeps {
  llm: LLMProvider;
  db: Database;
  config: Config;
  logger: Logger;
  registry?: ToolRegistry;
  sessionManager?: SessionManager;
  memoryManager?: PromptSources;
  skillManager?: SkillIndexSource;
  audit?: AuditService;
}

export class AgentCore {
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly sessionManager: SessionManager;
  private readonly loop: AgentLoop;

  constructor(private readonly deps: AgentCoreDeps) {
    this.registry = deps.registry ?? new ToolRegistry();
    this.executor = new ToolExecutor(this.registry);
    this.sessionManager = deps.sessionManager ?? new SessionManager({ db: deps.db });
    this.loop = new AgentLoop({
      llm: deps.llm,
      db: deps.db,
      registry: this.registry,
      executor: this.executor,
      sessionManager: this.sessionManager,
      config: deps.config,
      logger: deps.logger,
      systemPrompt: this.buildSystemPrompt(),
      audit: deps.audit,
    });
  }

  getToolRegistry(): ToolRegistry {
    return this.registry;
  }

  async run(input: AgentRunInput): Promise<AgentResult> {
    this.deps.logger.info(
      { userId: input.userId, sessionId: input.sessionId },
      'Agent run started',
    );
    try {
      const systemPrompt = this.buildSystemPrompt(input.userId, input.message);
      const result = await this.loop.run(input, systemPrompt);
      this.deps.logger.info(
        { sessionId: result.sessionId, iterations: result.iterations, finishReason: result.finishReason },
        'Agent run completed',
      );
      return result;
    } catch (error) {
      this.deps.logger.error({ error }, 'Agent run failed');
      throw error;
    }
  }

  /**
   * Compose the system prompt from the workspace identity files, relevant
   * durable memory, and the available skill index. The current user message is
   * used to select relevant memory without letting the prompt grow unbounded.
   */
  private buildSystemPrompt(userId?: number, query?: string): string {
    const parts: string[] = [];

    const soul = this.deps.memoryManager?.loadSoul() ?? loadSystemPrompt(this.deps.logger);
    parts.push(soul);

    const user = this.deps.memoryManager?.loadUser();
    if (user) parts.push(user);

    const memoryFile = this.deps.memoryManager?.loadMemoryFile();
    if (memoryFile) parts.push(memoryFile);

    if (userId !== undefined && query) {
      const memoryContext = this.deps.memoryManager?.buildMemoryContext(userId, query);
      if (memoryContext) parts.push(memoryContext);
    }

    const skills = this.deps.skillManager?.buildSkillIndex();
    if (skills) parts.push(skills);

    return parts.join('\n\n');
  }
}


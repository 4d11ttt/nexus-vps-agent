import { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../database/Database.js';
import type { AgentCore } from '../agent/AgentCore.js';
import type { SessionManager } from '../agent/SessionManager.js';
import type { AuditService } from '../audit/AuditService.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { SkillManager } from '../skills/SkillManager.js';
import type { Scheduler } from '../scheduler/Scheduler.js';
import type { ModelCatalog } from '../llm/ModelCatalog.js';
import type { LLMRuntimeConfig } from '../llm/LLMRuntimeConfig.js';
import type { UserSettingsService } from '../settings/UserSettingsService.js';
import { registerTelegramHandlers } from './handlers.js';
import { isAuthorized } from './authorization.js';
import { splitMessage } from './formatter.js';
import { ControlPanel } from './ControlPanel.js';

export interface TelegramBotDeps {
  config: Config;
  agentCore: AgentCore;
  sessionManager: SessionManager;
  logger: Logger;
  audit?: AuditService;
  db?: Database;
  modelCatalog?: ModelCatalog;
  runtimeConfig?: LLMRuntimeConfig;
  userSettings?: UserSettingsService;
  memoryManager?: MemoryManager;
  skillManager?: SkillManager;
  scheduler?: Scheduler;
}

/**
 * Thin wrapper around the grammY Bot.
 *
 * It owns the Bot instance, wires Telegram updates to the existing agent
 * handlers, and exposes a clean start/stop interface for the application
 * lifecycle. It also provides a `sendToUser` notifier for the scheduler that
 * enforces the same authorization boundary as normal messages.
 */
export class TelegramBot {
  private readonly bot: Bot;
  private readonly logger: Logger;
  private readonly allowedUserIds: number[];

  constructor(deps: TelegramBotDeps) {
    const token = deps.config.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required to create TelegramBot');
    }
    this.bot = new Bot(token);
    this.allowedUserIds = deps.config.TELEGRAM_ALLOWED_USER_IDS ?? [];
    this.logger = deps.logger.child({ component: 'TelegramBot' });

    // The Control Panel owns /menu and /model. It MUST be registered before the
    // generic `message:text` handler below; otherwise grammY routes command
    // text into AgentCore because `message:text` also matches bot commands.
    if (
      deps.db &&
      deps.modelCatalog &&
      deps.runtimeConfig &&
      deps.userSettings &&
      deps.memoryManager &&
      deps.skillManager
    ) {
      const controlPanel = new ControlPanel({
        config: deps.config,
        modelCatalog: deps.modelCatalog,
        runtimeConfig: deps.runtimeConfig,
        userSettings: deps.userSettings,
        memoryManager: deps.memoryManager,
        skillManager: deps.skillManager,
        sessionManager: deps.sessionManager,
        scheduler: deps.scheduler,
        audit: deps.audit,
        logger: this.logger,
      });
      controlPanel.register(this.bot);
    }

    registerTelegramHandlers(this.bot, {
      config: deps.config,
      agentCore: deps.agentCore,
      sessionManager: deps.sessionManager,
      logger: this.logger,
      audit: deps.audit,
      userSettings: deps.userSettings,
    });
  }

  /**
   * Start long polling. Resolves when the bot is stopped.
   */
  start(): Promise<void> {
    this.logger.info('Starting Telegram bot polling');
    return this.bot.start();
  }

  /**
   * Stop polling cleanly.
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping Telegram bot polling');
    await this.bot.stop();
  }

  /**
   * Send a message to an authorized Telegram user. Used by the scheduler to
   * deliver results. Unauthorized destinations are rejected.
   */
  async sendToUser(telegramUserId: number, text: string): Promise<void> {
    if (!isAuthorized(telegramUserId, this.allowedUserIds)) {
      this.logger.warn(
        { telegramUserId },
        'Refusing to send scheduled notification to unauthorized user',
      );
      return;
    }

    for (const chunk of splitMessage(text)) {
      await this.bot.api.sendMessage(telegramUserId, chunk);
    }
  }
}



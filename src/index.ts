import { loadEnvFile, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { Database } from './database/index.js';
import { AgentCore } from './agent/AgentCore.js';
import { SessionManager } from './agent/SessionManager.js';
import { ToolRegistry } from './agent/ToolRegistry.js';
import { OpenAICompatibleProvider } from './llm/OpenAICompatibleProvider.js';
import { ModelCatalog } from './llm/ModelCatalog.js';
import { registerCoreTools } from './tools/index.js';
import { TelegramBot } from './telegram/TelegramBot.js';
import { MemoryManager } from './memory/MemoryManager.js';
import { createMemoryTools } from './memory/tools.js';
import { SkillManager } from './skills/SkillManager.js';
import { createSkillTools } from './skills/tools.js';
import { Scheduler } from './scheduler/Scheduler.js';
import { createSchedulerTools } from './scheduler/tools.js';
import { AuditService } from './audit/AuditService.js';
import { UserSettingsService } from './settings/UserSettingsService.js';
import { AgentError, normalizeError } from './errors.js';

async function main(): Promise<void> {
  // 1. Load configuration (reads .env, validates).
  loadEnvFile();
  const config = loadConfig();

  // 2. Initialize logger.
  const logger = createLogger(config);

  // 3. Initialize database and apply migrations.
  const db = new Database(config, logger);
  db.open();

  // 4. Audit service.
  const audit = new AuditService(db);

  const needsLlm = config.TELEGRAM_ENABLED || config.SCHEDULER_ENABLED;

  // 5. Validate LLM configuration for any interface that reaches the agent.
  if (
    needsLlm &&
    (!config.LLM_API_BASE || !config.LLM_API_KEY || !config.LLM_MODEL)
  ) {
    audit.record({
      userId: null,
      eventType: 'config_failure',
      metadata: { reason: 'missing_llm_config' },
    });
    throw new AgentError(
      'LLM_API_BASE, LLM_API_KEY, and LLM_MODEL are required when Telegram or the scheduler is enabled',
      { code: 'CONFIG_ERROR' },
    );
  }

  let agentCore: AgentCore | undefined;
  let sessionManager: SessionManager | undefined;
  let registry: ToolRegistry | undefined;
  let memoryManager: MemoryManager | undefined;
  let skillManager: SkillManager | undefined;

  if (needsLlm) {
    // 6. Initialize LLM provider.
    const llm = new OpenAICompatibleProvider(config, logger);

    // 7. Initialize ToolRegistry and register core tools.
    registry = new ToolRegistry();
    registerCoreTools(registry);

    // 8. Initialize memory and skills; register their tools.
    memoryManager = new MemoryManager({ db, config, logger });
    for (const tool of createMemoryTools(memoryManager)) {
      registry.register(tool);
    }

    skillManager = new SkillManager({ db, config, logger });
    skillManager.discover();
    for (const tool of createSkillTools(skillManager)) {
      registry.register(tool);
    }

    // 9. Initialize session manager and agent core.
    sessionManager = new SessionManager({ db });
    agentCore = new AgentCore({
      llm,
      db,
      config,
      logger,
      registry,
      sessionManager,
      memoryManager,
      skillManager,
      audit,
    });
  }

  // 10. Shared services for the Telegram control panel.
  const userSettings = new UserSettingsService(db);
  const modelCatalog = new ModelCatalog({ config, logger });

  // 11. Initialize scheduler if enabled.
  let telegramBot: TelegramBot | undefined;
  let scheduler: Scheduler | undefined;

  if (config.SCHEDULER_ENABLED && agentCore && registry) {
    scheduler = new Scheduler({
      db,
      config,
      logger,
      runner: agentCore,
      notifier: {
        notify: async (telegramUserId: number, text: string) => {
          await telegramBot?.sendToUser(telegramUserId, text);
        },
      },
      audit,
    });
    for (const tool of createSchedulerTools(scheduler)) {
      registry.register(tool);
    }
  }

  // 12. Initialize Telegram if enabled.
  if (config.TELEGRAM_ENABLED && agentCore && sessionManager) {
    telegramBot = new TelegramBot({
      config,
      agentCore,
      sessionManager,
      logger,
      audit,
      db,
      modelCatalog,
      userSettings,
      memoryManager,
      skillManager,
      scheduler,
    });
  }

  // 12. Register graceful shutdown.
  let stopped = false;
  const stopAll = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      await scheduler?.stop();
    } catch {
      // ignore
    }
    try {
      await telegramBot?.stop();
    } catch {
      // ignore
    }
    try {
      db.close();
    } catch {
      // ignore
    }
  };

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await stopAll();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  // 13. Start the application.
  logger.info(
    { telegram: config.TELEGRAM_ENABLED, scheduler: config.SCHEDULER_ENABLED },
    'Application started',
  );

  scheduler?.start();

  if (telegramBot) {
    // Long polling blocks until stop() is called during shutdown.
    await telegramBot.start();
  } else if (scheduler) {
    // Keep the process alive until a termination signal. The scheduler timer
    // holds the event loop open.
    await new Promise<void>(() => {});
  } else {
    // No interface enabled: run migrations and exit cleanly (smoke-test mode).
    logger.info('Telegram and scheduler disabled; exiting after startup');
    await stopAll();
  }
}

main().catch((error: unknown) => {
  const err = normalizeError(error);
  const code = err instanceof AgentError ? err.code : 'UNEXPECTED_ERROR';
  // Use plain console here because the logger may not have been created yet.
  // eslint-disable-next-line no-console
  console.error(`[${code}] ${err.message}`);
  if (err.cause instanceof Error) {
    // eslint-disable-next-line no-console
    console.error('Caused by:', err.cause.message);
  }
  process.exit(1);
});



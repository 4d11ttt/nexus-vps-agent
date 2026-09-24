import { Bot, InlineKeyboard, type Context, type NextFunction } from 'grammy';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { SessionManager } from '../agent/SessionManager.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { SkillManager } from '../skills/SkillManager.js';
import type { Scheduler } from '../scheduler/Scheduler.js';
import type { AuditService } from '../audit/AuditService.js';
import { TelegramFormatter } from './TelegramFormatter.js';
import { ModelCatalog } from '../llm/ModelCatalog.js';
import { LLMRuntimeConfig } from '../llm/LLMRuntimeConfig.js';
import { UserSettingsService } from '../settings/UserSettingsService.js';
import { isAuthorizedContext } from './authorization.js';
import { resolveAgentUser, resolveSession } from './session.js';
import { systemInfoTool, systemResourcesTool } from '../tools/system/tool.js';
import { processListTool } from '../tools/process/tool.js';
import { shellTool } from '../tools/shell/tool.js';
import type { ToolContext } from '../tools/context.js';

const MODELS_PER_PAGE = 10;

/**
 * Explicit parent menu for every screen. Back buttons always target the
 * parent, so navigation never loops back onto the screen already shown
 * (which Telegram rejects with "message is not modified").
 */
const MENU_PARENTS: Record<string, string> = {
  // Category screens -> main menu.
  agent: 'main',
  server: 'main',
  intelligence: 'main',
  automation: 'main',
  channels: 'main',
  monitoring: 'main',
  settings: 'main',
  // Agent category.
  model: 'agent',
  provider: 'agent',
  // Server category.
  system: 'server',
  resources: 'server',
  processes: 'server',
  storage: 'server',
  network: 'server',
  // Intelligence category.
  memory: 'intelligence',
  skills: 'intelligence',
  // Automation category.
  scheduler: 'automation',
  jobs: 'automation',
  // Monitoring category.
  logs: 'monitoring',
  audit: 'monitoring',
  // Settings.
  about: 'settings',
};

/**
 * Resolve the Back target for a screen. Never returns the screen itself:
 * unknown screens fall back to the main menu.
 */
export function parentMenuOf(screen: string): string {
  const parent = MENU_PARENTS[screen];
  if (parent === undefined || parent === screen) return 'main';
  return parent;
}

/**
 * Guard for outgoing Telegram Control Center message text.
 *
 * Telegram rejects empty / invisible-only payloads with
 * `400 Bad Request: text must be non-empty` (a payload that renders as
 * nothing, such as a stray zero-width character, is rejected too). Every
 * Control Center message must therefore carry real visible text. If an
 * empty or invisible-only value ever reaches this helper, fall back to the
 * compact main-menu text instead of sending a rejected payload.
 */
export function ensureTelegramText(text: string): string {
  const visible = stripInvisible(text).length > 0;
  return visible ? text : MAIN_MENU_TEXT;
}

/** Remove invisible placeholder characters Telegram treats as empty. */
function stripInvisible(text: string): string {
  // U+200B/U+200C/U+200D zero-width characters and U+FEFF BOM render as
  // nothing and make Telegram reject the payload as empty text.
  const invisibles = [
    String.fromCharCode(0x200b),
    String.fromCharCode(0x200c),
    String.fromCharCode(0x200d),
    String.fromCharCode(0xfeff),
  ];
  let visible = text;
  for (const ch of invisibles) {
    visible = visible.split(ch).join('');
  }
  return visible.trim();
}

/** The canonical Control Center main-menu message text. */
const MAIN_MENU_TEXT = '⚡ <b>NEXUS VPS</b>';

/**
 * Detect Telegram's benign "message is not modified" error (HTTP 400), raised
 * when an edit would produce content identical to the current message. grammY
 * exposes the description on the error itself, on `response`, or on `payload`
 * depending on the error type.
 */
export function isMessageNotModifiedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const enriched = error as Error & {
    description?: unknown;
    response?: { description?: unknown };
    payload?: { description?: unknown };
  };
  const candidates = [
    error.message,
    enriched.description,
    enriched.response?.description,
    enriched.payload?.description,
  ];
  return candidates.some(
    (candidate) =>
      typeof candidate === 'string' &&
      candidate.toLowerCase().includes('message is not modified'),
  );
}

export interface ControlPanelDeps {
  config: Config;
  modelCatalog: ModelCatalog;
  runtimeConfig: LLMRuntimeConfig;
  userSettings: UserSettingsService;
  memoryManager: MemoryManager;
  skillManager: SkillManager;
  sessionManager: SessionManager;
  scheduler?: Scheduler;
  audit?: AuditService;
  logger: Logger;
}

interface CallbackAction {
  menu: string;
  sub?: string;
  arg?: string;
}

type PendingInputMode = 'provider_base_url' | 'provider_api_key';

interface PendingInput {
  mode: PendingInputMode;
}

export class ControlPanel {
  private readonly formatter = new TelegramFormatter();
  private readonly modelTokens = new Map<number, Map<string, string>>();
  private readonly pendingInput = new Map<number, PendingInput>();

  constructor(private readonly deps: ControlPanelDeps) {}

  register(bot: Bot): void {
    const logger = this.deps.logger.child({ component: 'ControlPanel' });

    bot.command('start', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;
      if (!this.isPrivateChat(ctx)) return;
      logger.info({ telegramUserId: ctx.from?.id }, '/start command');
      await this.showMainMenu(ctx);
    });

    bot.command('menu', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;
      if (!this.isPrivateChat(ctx)) return;
      await this.showMainMenu(ctx);
    });

    bot.command('model', async (ctx) => {
      if (!this.isAuthorized(ctx)) return;
      if (!this.isPrivateChat(ctx)) return;
      await this.showModelMenu(ctx);
    });

    // Intercept free-text replies for active Control Center input modes
    // (e.g. entering a new Base URL or API key). Normal messages fall through
    // to the generic AgentCore handler.
    bot.on('message:text', async (ctx: Context, next: NextFunction) => {
      if (!this.isAuthorized(ctx)) {
        await next();
        return;
      }
      if (!this.isPrivateChat(ctx)) {
        await next();
        return;
      }

      const userId = ctx.from?.id;
      const text = ctx.message?.text;
      if (userId === undefined || text === undefined) {
        await next();
        return;
      }

      const pending = this.pendingInput.get(userId);
      if (!pending) {
        await next();
        return;
      }

      this.pendingInput.delete(userId);

      try {
        if (pending.mode === 'provider_base_url') {
          await this.handleProviderBaseUrlInput(ctx, text);
        } else if (pending.mode === 'provider_api_key') {
          await this.handleProviderApiKeyInput(ctx, text);
        }
      } catch (error) {
        logger.error({ error, userId }, 'Control panel input mode failed');
        await ctx.reply('❌ <b>Update failed</b>\n\nPlease try again.', { parse_mode: 'HTML' }).catch(() => {});
      }
    });

    bot.on('callback_query:data', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.answerCallbackQuery({ text: 'Unauthorized' }).catch(() => {});
        return;
      }

      const action = this.parseCallback(ctx.callbackQuery.data ?? '');
      if (!action) {
        await ctx.answerCallbackQuery().catch(() => {});
        return;
      }

      logger.debug({ action }, 'Control panel callback');

      try {
        await this.dispatch(ctx, action);
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          // The edit produced identical content (e.g. a stale keyboard or a
          // Back button that points at the menu already shown). The callback
          // is acknowledged as success; this is not an error.
          await ctx.answerCallbackQuery().catch(() => {});
          logger.debug({ action }, 'Menu edit skipped: content unchanged');
          return;
        }
        logger.error({ error, action }, 'Control panel dispatch failed');
        await ctx.answerCallbackQuery({ text: 'Action failed' }).catch(() => {});
      }
    });
  }

  private async dispatch(ctx: Context, action: CallbackAction): Promise<void> {
    switch (action.menu) {
      case 'main':
        await this.showMainMenu(ctx);
        break;
      case 'agent':
        await this.showAgentMenu(ctx);
        break;
      case 'server':
        await this.showServerMenu(ctx);
        break;
      case 'intelligence':
        await this.showIntelligenceMenu(ctx);
        break;
      case 'automation':
        await this.showAutomationMenu(ctx);
        break;
      case 'monitoring':
        await this.showMonitoringMenu(ctx);
        break;
      case 'model':
        await this.dispatchModel(ctx, action);
        break;
      case 'provider':
        await this.dispatchProvider(ctx, action);
        break;
      case 'memory':
        await this.dispatchMemory(ctx, action);
        break;
      case 'skills':
        await this.dispatchSkills(ctx, action);
        break;
      case 'system':
        await this.showSystemInfo(ctx);
        break;
      case 'resources':
        await this.showResources(ctx);
        break;
      case 'processes':
        await this.dispatchProcesses(ctx, action);
        break;
      case 'storage':
        await this.showStorage(ctx);
        break;
      case 'network':
        await this.showNetwork(ctx);
        break;
      case 'scheduler':
        await this.dispatchScheduler(ctx, action);
        break;
      case 'jobs':
        await this.showJobs(ctx);
        break;
      case 'settings':
        await this.showSettings(ctx);
        break;
      case 'logs':
        await this.showLogs(ctx);
        break;
      case 'audit':
        await this.showAudit(ctx);
        break;
      case 'channels':
        await this.showChannels(ctx, action.sub);
        break;
      case 'refresh':
        await this.showMainMenu(ctx);
        break;
      case 'about':
        await this.showAbout(ctx);
        break;
      default:
        await ctx.answerCallbackQuery().catch(() => {});
    }
  }

  private isAuthorized(ctx: Context): boolean {
    const allowedUserIds = this.deps.config.TELEGRAM_ALLOWED_USER_IDS ?? [];
    return isAuthorizedContext(ctx, allowedUserIds);
  }

  private isPrivateChat(ctx: Context): boolean {
    return ctx.chat?.type === 'private';
  }

  private async resolveUser(ctx: Context) {
    const telegramUserId = ctx.from?.id;
    if (telegramUserId === undefined) {
      throw new Error('Callback without identifiable user');
    }
    const username = ctx.from?.username;
    const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || undefined;
    const user = await resolveAgentUser(telegramUserId, username, displayName, this.deps.sessionManager);
    const session = await resolveSession(user, this.deps.sessionManager);
    return { user, session };
  }

  private makeToolContext(userId: number, sessionId: number): ToolContext {
    return {
      userId,
      sessionId,
      logger: this.deps.logger,
      config: this.deps.config,
    };
  }

  private parseCallback(data: string): CallbackAction | undefined {
    if (!data.startsWith('menu:')) return undefined;
    const parts = data.split(':');
    if (parts.length < 2) return undefined;
    return {
      menu: parts[1],
      sub: parts[2],
      arg: parts.slice(3).join(':'),
    };
  }

  private async editMenu(
    ctx: Context,
    text: string,
    keyboard: InlineKeyboard,
  ): Promise<void> {
    // Guard every Control Center edit: Telegram rejects empty /
    // invisible-only payloads with 400 "text must be non-empty".
    await ctx.editMessageText(ensureTelegramText(text), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  private async answer(ctx: Context, text?: string): Promise<void> {
    await ctx.answerCallbackQuery(text ? { text } : undefined).catch(() => {});
  }

  private backButton(target: string, label = '⬅️ Back'): { text: string; callback_data: string } {
    return { text: label, callback_data: `menu:${target}` };
  }

  /** Back button for a top-level screen; always targets its parent menu. */
  private backFor(screen: string): { text: string; callback_data: string } {
    return this.backButton(parentMenuOf(screen));
  }

  // ---------------------------------------------------------------------------
  // Main menu
  // ---------------------------------------------------------------------------

  private async showMainMenu(ctx: Context): Promise<void> {
    // Real visible text only: Telegram rejects empty / invisible-only
    // payloads with 400 "text must be non-empty".
    const text = MAIN_MENU_TEXT;

    const keyboard = new InlineKeyboard()
      .text('🤖 Agent', 'menu:agent')
      .text('🖥️ Server', 'menu:server')
      .row()
      .text('🧠 Intelligence', 'menu:intelligence')
      .text('🌐 Network', 'menu:network')
      .row()
      .text('⏰ Automation', 'menu:automation')
      .text('📡 Channels', 'menu:channels')
      .row()
      .text('⚙️ Settings', 'menu:settings')
      .text('📋 Monitoring', 'menu:monitoring')
      .row()
      .text('ℹ️ About', 'menu:about');

    if (ctx.callbackQuery) {
      await this.editMenu(ctx, text, keyboard);
      await this.answer(ctx);
    } else {
      // Single Control Center message for /menu: real text plus keyboard.
      await ctx.reply(ensureTelegramText(text), { parse_mode: 'HTML', reply_markup: keyboard });
    }
  }


  // ---------------------------------------------------------------------------
  // Category menus
  // ---------------------------------------------------------------------------

  private async showAgentMenu(ctx: Context): Promise<void> {
    const text = '🤖 <b>Agent</b>';
    const keyboard = new InlineKeyboard()
      .text('🤖 Model', 'menu:model')
      .text('🔌 Provider', 'menu:provider')
      .row()
      .add(this.backButton('main'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async showServerMenu(ctx: Context): Promise<void> {
    const text = `🖥️ <b>Server</b>\n\nLive VPS status: system, resources, processes, storage, network.`;
    const keyboard = new InlineKeyboard()
      .text('🖥️ System', 'menu:system')
      .text('📊 Resources', 'menu:resources')
      .row()
      .text('⚙️ Processes', 'menu:processes')
      .text('💾 Storage', 'menu:storage')
      .row()
      .text('🌐 Network', 'menu:network')
      .row()
      .add(this.backButton('main'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async showIntelligenceMenu(ctx: Context): Promise<void> {
    const text = `🧠 <b>Intelligence</b>\n\nPersistent memory and reusable skills.`;
    const keyboard = new InlineKeyboard()
      .text('🧠 Memory', 'menu:memory')
      .text('🛠️ Skills', 'menu:skills')
      .row()
      .add(this.backButton('main'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async showAutomationMenu(ctx: Context): Promise<void> {
    const text = `⏰ <b>Automation</b>\n\nScheduler status and recurring jobs.`;
    const keyboard = new InlineKeyboard()
      .text('⏰ Scheduler', 'menu:scheduler')
      .text('📋 Jobs', 'menu:jobs')
      .row()
      .add(this.backButton('main'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async showMonitoringMenu(ctx: Context): Promise<void> {
    const text = `📜 <b>Monitoring</b>\n\nRuntime logs and audit trail.`;
    const keyboard = new InlineKeyboard()
      .text('📜 Logs', 'menu:logs')
      .text('🛡️ Audit', 'menu:audit')
      .row()
      .add(this.backButton('main'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private safeChunk(text: string, maxLength = 3800): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 20) + '\n…(truncated)';
  }

  // ---------------------------------------------------------------------------
  // Model menu
  // ---------------------------------------------------------------------------

  private async dispatchModel(ctx: Context, action: CallbackAction): Promise<void> {
    switch (action.sub) {
      case 'list':
        await this.showModelList(ctx, Number(action.arg ?? '0'));
        break;
      case 'refresh':
        await this.refreshModels(ctx);
        break;
      case 'page':
        await this.showModelList(ctx, Number(action.arg ?? '0'));
        break;
      case 'select':
        await this.selectModel(ctx, action.arg ?? '');
        break;
      default:
        await this.showModelMenu(ctx);
    }
  }

  private async showModelMenu(ctx: Context): Promise<void> {
    const { user } = await this.resolveUser(ctx);
    const current = this.deps.userSettings.getModel(user.id) ?? this.deps.runtimeConfig.getDefaultModel() ?? 'not configured';

    const text = `🤖 <b>Model</b>\n\nCurrent:\n<code>${this.escape(current)}</code>`;
    const keyboard = new InlineKeyboard()
      .text('🤖 Models', 'menu:model:list:0')
      .row()
      .text('🔄 Refresh Models', 'menu:model:refresh')
      .row()
      .add(this.backFor('model'));

    if (ctx.callbackQuery) {
      await this.editMenu(ctx, text, keyboard);
      await this.answer(ctx);
    } else {
      await ctx.reply(ensureTelegramText(text), { parse_mode: 'HTML', reply_markup: keyboard });
    }
  }

  private async refreshModels(ctx: Context): Promise<void> {
    await this.answer(ctx, '🔄 Fetching models...');
    try {
      const models = await this.deps.modelCatalog.listModels({ refresh: true });
      const text = `🤖 <b>Model</b>\n\n✓ <i>${models.length} models available</i>`;
      const keyboard = new InlineKeyboard()
        .text('🤖 Models', 'menu:model:list:0')
        .row()
        .text('🔄 Refresh Models', 'menu:model:refresh')
        .row()
        .add(this.backFor('model'));
      await this.editMenu(ctx, text, keyboard);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const text = `🤖 <b>Model</b>\n\n⚠️ <i>Unable to fetch models</i>\n\n<code>${this.escape(message.slice(0, 200))}</code>`;
      const keyboard = new InlineKeyboard()
        .text('🔄 Retry', 'menu:model:refresh')
        .row()
        .add(this.backFor('model'));
      await this.editMenu(ctx, text, keyboard);
    }
  }

  private async showModelList(ctx: Context, page: number): Promise<void> {
    const { user } = await this.resolveUser(ctx);
    const models = await this.deps.modelCatalog.listModels();
    const totalPages = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const start = safePage * MODELS_PER_PAGE;
    const pageModels = models.slice(start, start + MODELS_PER_PAGE);

    const tokenMap = new Map<string, string>();
    this.modelTokens.set(user.id, tokenMap);

    const currentModel = this.deps.userSettings.getModel(user.id) ?? this.deps.runtimeConfig.getDefaultModel();

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < pageModels.length; i++) {
      const model = pageModels[i];
      const token = `m${i}`;
      tokenMap.set(token, model.id);
      const prefix = model.id === currentModel ? '✓ ' : '';
      const label = `${prefix}${model.id}`.slice(0, 64);
      keyboard.text(label, `menu:model:select:${token}`).row();
    }

    if (safePage > 0) keyboard.text('◀️ Prev', `menu:model:page:${safePage - 1}`);
    if (safePage < totalPages - 1) keyboard.text('Next ▶️', `menu:model:page:${safePage + 1}`);
    if (safePage > 0 || safePage < totalPages - 1) keyboard.row();

    keyboard.text('🔄 Refresh', 'menu:model:refresh').row();
    keyboard.add(this.backButton('model'));

    const text = `🤖 <b>Select Model</b>\n\nPage ${safePage + 1} / ${totalPages} · ${models.length} models`;
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async selectModel(ctx: Context, token: string): Promise<void> {
    const { user } = await this.resolveUser(ctx);
    const tokenMap = this.modelTokens.get(user.id);
    const modelId = tokenMap?.get(token);
    if (!modelId) {
      await this.answer(ctx, 'Model selection expired. Please refresh.');
      return;
    }

    this.deps.userSettings.setModel(user.id, modelId);
    this.deps.audit?.record({
      userId: user.id,
      eventType: 'model_selected',
      metadata: { model: modelId },
    });

    const text = `🤖 <b>Model</b>\n\nCurrent:\n<code>${this.escape(modelId)}</code>\n\n✓ <i>Model updated</i>`;
    const keyboard = new InlineKeyboard()
      .text('🤖 Models', 'menu:model:list:0')
      .row()
      .text('🔄 Refresh Models', 'menu:model:refresh')
      .row()
      .add(this.backFor('model'));

    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx, `Model set to ${modelId}`);
  }

  // ---------------------------------------------------------------------------
  // Provider menu
  // ---------------------------------------------------------------------------

  private async dispatchProvider(ctx: Context, action: CallbackAction): Promise<void> {
    switch (action.sub) {
      case 'test':
        await this.testProviderConnection(ctx);
        return;
      case 'base_url':
        await this.promptProviderBaseUrl(ctx);
        return;
      case 'api_key':
        await this.promptProviderApiKey(ctx);
        return;
      default:
        await this.showProviderMenu(ctx);
    }
  }

  private async showProviderMenu(ctx: Context, sendAsReply = false): Promise<void> {
    const baseUrl = this.deps.runtimeConfig.getApiBase();

    const text =
      `🔌 <b>Provider</b>\n\n` +
      `Provider:\n<code>OpenAI-Compatible</code>\n\n` +
      `Base URL:\n<code>${this.escape(baseUrl || 'not configured')}</code>\n\n` +
      `API Key:\n<code>${this.escape(this.deps.runtimeConfig.maskApiKey())}</code>`;

    const keyboard = new InlineKeyboard()
      .text('🌐 Base URL', 'menu:provider:base_url')
      .text('🔑 API Key', 'menu:provider:api_key')
      .row()
      .text('🧪 Test Connection', 'menu:provider:test')
      .text('🤖 Models', 'menu:model')
      .row()
      .add(this.backFor('provider'));

    if (sendAsReply) {
      await ctx.reply(ensureTelegramText(text), { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await this.editMenu(ctx, text, keyboard);
      await this.answer(ctx);
    }
  }

  private async testProviderConnection(ctx: Context): Promise<void> {
    await this.answer(ctx, '🧪 Testing connection...');
    const status = await this.deps.modelCatalog.testConnection();
    const statusLine = status.ok
      ? '✓ <b>Connected</b>'
      : `⚠️ <b>Error</b>\n<code>${this.escape(status.error?.slice(0, 200) ?? 'unknown')}</code>`;

    const text =
      `🔌 <b>Provider</b>\n\n` +
      `Base URL:\n<code>${this.escape(this.deps.runtimeConfig.getApiBase() || 'not configured')}</code>\n\n` +
      `Status:\n${statusLine}`;

    const keyboard = new InlineKeyboard()
      .text('🧪 Test Connection', 'menu:provider:test')
      .row()
      .text('🤖 Models', 'menu:model')
      .row()
      .add(this.backFor('provider'));

    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async promptProviderBaseUrl(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    this.pendingInput.set(userId, { mode: 'provider_base_url' });
    const text =
      `🌐 <b>Base URL</b>\n\n` +
      `Send the new base URL for the OpenAI-compatible provider.\n\n` +
      `Example: <code>https://api.example.com/v1</code>`;
    await this.editMenu(ctx, text, new InlineKeyboard().add(this.backFor('provider')));
    await this.answer(ctx, 'Send the new base URL');
  }

  private async handleProviderBaseUrlInput(ctx: Context, text: string): Promise<void> {
    try {
      this.deps.runtimeConfig.setApiBase(text);
      this.deps.audit?.record({
        userId: (await this.resolveUser(ctx)).user.id,
        eventType: 'provider_base_url_updated',
        metadata: { base_url: this.deps.runtimeConfig.getApiBase() },
      });
      await ctx.reply('✓ <b>Base URL updated</b>', { parse_mode: 'HTML' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid URL';
      await ctx.reply(`❌ <b>Invalid base URL</b>\n\n${this.escape(message)}`, { parse_mode: 'HTML' });
    }
    await this.showProviderMenu(ctx, true);
  }

  private async promptProviderApiKey(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    this.pendingInput.set(userId, { mode: 'provider_api_key' });
    const text =
      `🔑 <b>API Key</b>\n\n` +
      `Send the new API key in a private message.\n\n` +
      `It will be stored securely and deleted from the chat when possible.`;
    await this.editMenu(ctx, text, new InlineKeyboard().add(this.backFor('provider')));
    await this.answer(ctx, 'Send the new API key privately');
  }

  private async handleProviderApiKeyInput(ctx: Context, text: string): Promise<void> {
    const messageId = ctx.message?.message_id;

    this.deps.runtimeConfig.setApiKey(text);

    const { user } = await this.resolveUser(ctx);
    this.deps.audit?.record({
      userId: user.id,
      eventType: 'provider_api_key_updated',
      metadata: {},
    });

    // Best-effort deletion of the key message so it does not remain in chat.
    if (messageId !== undefined) {
      try {
        await ctx.deleteMessage();
      } catch {
        // Deletion may fail due to permissions or message age; the key is
        // already stored securely, so this is non-fatal.
      }
    }

    await ctx.reply('✓ <b>API key updated</b>', { parse_mode: 'HTML' });
    await this.showProviderMenu(ctx, true);
  }

  private escape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ---------------------------------------------------------------------------
  // Memory menu
  // ---------------------------------------------------------------------------

  private async dispatchMemory(ctx: Context, action: CallbackAction): Promise<void> {
    switch (action.sub) {
      case 'browse':
        await this.memoryBrowse(ctx);
        break;
      case 'search':
        await this.memorySearch(ctx);
        break;
      case 'manage':
        await this.memoryManage(ctx);
        break;
      default:
        await this.showMemoryMenu(ctx);
    }
  }

  private async showMemoryMenu(ctx: Context): Promise<void> {
    const { user } = await this.resolveUser(ctx);
    const count = this.deps.memoryManager.list(user.id).length;
    const text = `🧠 <b>Memory</b>\n\nStored memories: <code>${count}</code>`;
    const keyboard = new InlineKeyboard()
      .text('🔎 Search', 'menu:memory:search')
      .text('📋 Browse', 'menu:memory:browse')
      .row()
      .text('🗑️ Manage', 'menu:memory:manage')
      .row()
      .add(this.backFor('memory'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async memoryBrowse(ctx: Context): Promise<void> {
    const { user } = await this.resolveUser(ctx);
    const memories = this.deps.memoryManager.list(user.id);
    const lines = memories.slice(0, 20).map((m) => `• <code>${this.escape(m.key)}</code> — ${this.escape(m.content.slice(0, 60))}`);
    const text = `🧠 <b>Memory Browse</b>\n\n${lines.length > 0 ? lines.join('\n') : 'No memories stored.'}`;
    const keyboard = new InlineKeyboard().add(this.backButton('memory'));
    await this.editMenu(ctx, this.safeChunk(text), keyboard);
    await this.answer(ctx);
  }

  private async memorySearch(ctx: Context): Promise<void> {
    const text =
      `🧠 <b>Memory Search</b>\n\n` +
      `Ketik kata kunci di chat untuk mencari memory.\n` +
      `Contoh: <code>cari memory nginx</code>`;
    const keyboard = new InlineKeyboard().add(this.backButton('memory'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async memoryManage(ctx: Context): Promise<void> {
    const text =
      `🧠 <b>Memory Manage</b>\n\n` +
      `Gunakan perintah natural language untuk mengubah atau menghapus memory.\n` +
      `Contoh: <code>hapus memory tentang nginx</code>`;
    const keyboard = new InlineKeyboard().add(this.backButton('memory'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  // ---------------------------------------------------------------------------
  // Skills menu
  // ---------------------------------------------------------------------------

  private async dispatchSkills(ctx: Context, action: CallbackAction): Promise<void> {
    switch (action.sub) {
      case 'list':
        await this.skillList(ctx);
        break;
      case 'reload':
        await this.skillReload(ctx);
        break;
      case 'read':
        await this.skillRead(ctx, action.arg ?? '');
        break;
      default:
        await this.showSkillsMenu(ctx);
    }
  }

  private async showSkillsMenu(ctx: Context): Promise<void> {
    const skills = this.deps.skillManager.list();
    const text = `🛠️ <b>Skills</b>\n\nAvailable: <code>${skills.length}</code>`;
    const keyboard = new InlineKeyboard()
      .text('📋 List', 'menu:skills:list')
      .text('📖 Read', 'menu:skills:list')
      .row()
      .text('🔄 Reload', 'menu:skills:reload')
      .row()
      .add(this.backFor('skills'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async skillList(ctx: Context): Promise<void> {
    const skills = this.deps.skillManager.list();
    const keyboard = new InlineKeyboard();
    for (const skill of skills.slice(0, 20)) {
      keyboard.text(skill.name, `menu:skills:read:${encodeURIComponent(skill.name)}`).row();
    }
    keyboard.add(this.backButton('skills'));
    const text = `🛠️ <b>Skills</b>\n\nSelect a skill to read:`;
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async skillReload(ctx: Context): Promise<void> {
    this.deps.skillManager.discover();
    const count = this.deps.skillManager.list().length;
    const text = `🛠️ <b>Skills</b>\n\n✓ <i>Reloaded ${count} skills</i>`;
    const keyboard = new InlineKeyboard()
      .text('📋 List', 'menu:skills:list')
      .row()
      .add(this.backFor('skills'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx, `Reloaded ${count} skills`);
  }

  private async skillRead(ctx: Context, encodedName: string): Promise<void> {
    const name = decodeURIComponent(encodedName);
    const content = this.deps.skillManager.read(name);
    const text = content !== undefined
      ? `📖 <b>${this.escape(name)}</b>\n\n<pre>${this.escape(content.slice(0, 3500))}</pre>`
      : `⚠️ Skill <code>${this.escape(name)}</code> not found.`;
    const keyboard = new InlineKeyboard().add(this.backButton('skills'));
    await this.editMenu(ctx, this.safeChunk(text), keyboard);
    await this.answer(ctx);
  }

  // ---------------------------------------------------------------------------
  // Server menus
  // ---------------------------------------------------------------------------

  private async showSystemInfo(ctx: Context): Promise<void> {
    const { user, session } = await this.resolveUser(ctx);
    const toolCtx = this.makeToolContext(user.id, session.id);
    const output = await systemInfoTool.execute({}, toolCtx);
    const chunks = this.formatter.formatResponse(output, { finishReason: 'completed', toolCalls: 1 });
    await this.sendFormattedResult(ctx, chunks, 'system');
  }

  private async showResources(ctx: Context): Promise<void> {
    const { user, session } = await this.resolveUser(ctx);
    const toolCtx = this.makeToolContext(user.id, session.id);
    const output = await systemResourcesTool.execute({}, toolCtx);
    const chunks = this.formatter.formatResponse(output, { finishReason: 'completed', toolCalls: 1 });
    await this.sendFormattedResult(ctx, chunks, 'resources');
  }

  private async dispatchProcesses(ctx: Context, action: CallbackAction): Promise<void> {
    if (action.sub === 'inspect') {
      await this.answer(ctx, 'Use natural language to inspect a PID, e.g. "inspect process 1234"');
      return;
    }
    await this.showProcesses(ctx);
  }

  private async showProcesses(ctx: Context): Promise<void> {
    const { user, session } = await this.resolveUser(ctx);
    const toolCtx = this.makeToolContext(user.id, session.id);
    const output = await processListTool.execute({}, toolCtx);
    const chunks = this.formatter.formatResponse(output, { finishReason: 'completed', toolCalls: 1 });
    await this.sendFormattedResult(ctx, chunks, 'processes');
  }

  private async showStorage(ctx: Context): Promise<void> {
    const { user, session } = await this.resolveUser(ctx);
    const toolCtx = this.makeToolContext(user.id, session.id);
    const output = await shellTool.execute({ command: 'df -h' }, toolCtx);
    const chunks = this.formatter.formatResponse(output, { finishReason: 'completed', toolCalls: 1 });
    await this.sendFormattedResult(ctx, chunks, 'storage');
  }

  private async showNetwork(ctx: Context): Promise<void> {
    const { user, session } = await this.resolveUser(ctx);
    const toolCtx = this.makeToolContext(user.id, session.id);
    const commands = ['hostname -I', 'ip -brief addr 2>/dev/null || ifconfig 2>/dev/null || echo "no network tool"'];
    let combined = '';
    for (const command of commands) {
      const out = await shellTool.execute({ command }, toolCtx);
      combined += `\n$ ${command}\n${out}`;
    }
    const chunks = this.formatter.formatResponse(combined.trim(), { finishReason: 'completed', toolCalls: 1 });
    await this.sendFormattedResult(ctx, chunks, 'network');
  }

  private async sendFormattedResult(
    ctx: Context,
    chunks: Array<{ text: string; parseMode: 'HTML' | undefined }>,
    backTarget: string,
  ): Promise<void> {
    const text = chunks.map((c) => c.text).join('\n');
    const keyboard = new InlineKeyboard().add(this.backButton(parentMenuOf(backTarget)));
    await this.editMenu(ctx, this.safeChunk(text), keyboard);
    await this.answer(ctx);
  }
  // ---------------------------------------------------------------------------
  // Scheduler / Jobs
  // ---------------------------------------------------------------------------

  private async dispatchScheduler(ctx: Context, action: CallbackAction): Promise<void> {
    if (action.sub === 'jobs') {
      await this.showJobs(ctx);
      return;
    }
    await this.showSchedulerMenu(ctx);
  }

  private async showSchedulerMenu(ctx: Context): Promise<void> {
    const enabled = this.deps.config.SCHEDULER_ENABLED;
    const started = this.deps.scheduler !== undefined; // rough proxy; Scheduler does not expose started flag publicly
    const status = enabled && started ? '● Running' : '● Disabled';
    const jobCount = this.deps.scheduler ? 'see Jobs menu' : 'N/A';

    const text =
      `⏰ <b>Scheduler</b>\n\n` +
      `Status: ${status}\n` +
      `Poll interval: <code>${this.deps.config.SCHEDULER_POLL_INTERVAL_MS}ms</code>\n` +
      `Jobs: <code>${jobCount}</code>`;

    const keyboard = new InlineKeyboard()
      .text('📋 Jobs', 'menu:jobs')
      .row()
      .add(this.backFor('scheduler'));

    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async showJobs(ctx: Context): Promise<void> {
    const { user } = await this.resolveUser(ctx);
    const jobs = this.deps.scheduler?.listJobs(user.id) ?? [];
    const lines = jobs.slice(0, 20).map((j) => {
      const status = j.status;
      const enabled = j.enabled ? '●' : '○';
      return `${enabled} <code>${this.escape(j.name)}</code> — ${this.escape(status)}`;
    });
    const text = `📋 <b>Jobs</b>\n\n${lines.length > 0 ? lines.join('\n') : 'No jobs.'}`;
    const keyboard = new InlineKeyboard().add(this.backFor('jobs'));
    await this.editMenu(ctx, this.safeChunk(text), keyboard);
    await this.answer(ctx);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  private async showSettings(ctx: Context): Promise<void> {
    const { user } = await this.resolveUser(ctx);
    const model = this.deps.userSettings.getModel(user.id) ?? this.deps.config.LLM_MODEL ?? 'default';
    const text =
      `⚙️ <b>Settings</b>\n\n` +
      `• Model — <code>${this.escape(model)}</code>\n` +
      `• Temperature — <code>${this.deps.config.LLM_TEMPERATURE ?? 'default'}</code>\n` +
      `• Max tokens — <code>${this.deps.config.LLM_MAX_TOKENS ?? 'default'}</code>\n` +
      `• Timeout — <code>${this.deps.config.LLM_TIMEOUT_MS}ms</code>\n` +
      `• Memory — <code>enabled</code>\n` +
      `• Scheduler — <code>${this.deps.config.SCHEDULER_ENABLED ? 'enabled' : 'disabled'}</code>`;

    const keyboard = new InlineKeyboard()
      .text('🤖 Change Model', 'menu:model')
      .row()
      .text('ℹ️ About', 'menu:about')
      .row()
      .add(this.backButton('main'));

    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  // ---------------------------------------------------------------------------
  // Logs / Audit
  // ---------------------------------------------------------------------------

  private async showLogs(ctx: Context): Promise<void> {
    const text =
      `📜 <b>Logs</b>\n\n` +
      `Log level: <code>${this.escape(this.deps.config.LOG_LEVEL)}</code>\n` +
      `Environment: <code>${this.escape(this.deps.config.NODE_ENV)}</code>\n\n` +
      `Lihat log di filesystem server atau konsol.`;
    const keyboard = new InlineKeyboard().add(this.backFor('logs'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  private async showAudit(ctx: Context): Promise<void> {
    const text =
      `🛡️ <b>Audit</b>\n\n` +
      `Audit events are persisted in the database.\n` +
      `Total events are available via server-side queries.`;
    const keyboard = new InlineKeyboard().add(this.backFor('audit'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  private async showChannels(ctx: Context, channel?: string): Promise<void> {
    const telegramStatus = this.deps.config.TELEGRAM_ENABLED ? '● Enabled' : '○ Disabled';
    const wsStatus = '○ Not available';

    if (channel === 'telegram') {
      const text =
        `📡 <b>Telegram</b>\n\n` +
        `Status: ${telegramStatus}\n` +
        `Allowed users: <code>${this.deps.config.TELEGRAM_ALLOWED_USER_IDS?.length ?? 0}</code>`;
      const keyboard = new InlineKeyboard().add(this.backButton('channels'));
      await this.editMenu(ctx, text, keyboard);
      await this.answer(ctx);
      return;
    }

    if (channel === 'websocket') {
      const text =
        `🌐 <b>WebSocket</b>\n\n` +
        `Status: ${wsStatus}\n\n` +
        `No WebSocket server is configured in this deployment.`;
      const keyboard = new InlineKeyboard().add(this.backButton('channels'));
      await this.editMenu(ctx, text, keyboard);
      await this.answer(ctx);
      return;
    }

    const text =
      `📡 <b>Channels</b>\n\n` +
      `Telegram:\n${telegramStatus}\n\n` +
      `WebSocket:\n${wsStatus}`;
    const keyboard = new InlineKeyboard()
      .text('📡 Telegram', 'menu:channels:telegram')
      .text('🌐 WebSocket', 'menu:channels:websocket')
      .row()
      .add(this.backButton('main'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }

  // ---------------------------------------------------------------------------
  // About
  // ---------------------------------------------------------------------------

  private async showAbout(ctx: Context): Promise<void> {
    const text =
      `ℹ️ <b>About NEXUS VPS Agent</b>\n\n` +
      `Autonomous Telegram agent for Debian VPS management.\n` +
      `Version: <code>0.1.0</code>\n` +
      `Node: <code>${process.version}</code>`;
    const keyboard = new InlineKeyboard().add(this.backFor('about'));
    await this.editMenu(ctx, text, keyboard);
    await this.answer(ctx);
  }
}




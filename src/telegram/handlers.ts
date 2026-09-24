import type { Bot, Context } from 'grammy';
import type { Logger } from 'pino';
import type { AgentCore } from '../agent/AgentCore.js';
import type { SessionManager } from '../agent/SessionManager.js';
import type { Config } from '../config.js';
import type { AuditService } from '../audit/AuditService.js';
import type { UserSettingsService } from '../settings/UserSettingsService.js';
import { withModelOverride } from '../llm/ModelContext.js';
import { isAuthorizedContext } from './authorization.js';
import { TelegramFormatter } from './TelegramFormatter.js';
import { resolveAgentUser, resolveSession, getTelegramUserMeta } from './session.js';

export interface TelegramHandlersDeps {
  config: Config;
  agentCore: AgentCore;
  sessionManager: SessionManager;
  logger: Logger;
  audit?: AuditService;
  userSettings?: UserSettingsService;
}

const formatter = new TelegramFormatter();

const UNAUTHORIZED_MESSAGE =
  'You are not authorized to use this bot.';

const HELP_MESSAGE =
  'Cara menggunakan NEXUS VPS Agent:\n' +
  '- Kirim pesan teks biasa untuk memberi tugas kepada agen.\n' +
  '- Agen akan merencanakan, menjalankan tool internal, dan memverifikasi hasil.\n' +
  '- Perintah tersedia: /start, /help, /status.\n\n' +
  'Tool seperti shell, filesystem, dan package manager dipilih otomatis oleh agen, bukan melalui perintah Telegram.';

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private';
}

/**
 * Detect Telegram bot commands.
 *
 * grammY's `message:text` matcher also matches command messages. Commands must
 * be handled by their dedicated command handlers (e.g. ControlPanel /menu and
 * /model) and must never fall through into AgentCore or receive the processing
 * reaction.
 */
function isBotCommand(ctx: Context): boolean {
  const entities = ctx.message?.entities;
  if (entities?.some((entity) => entity.type === 'bot_command' && entity.offset === 0)) {
    return true;
  }
  const text = ctx.message?.text?.trim();
  if (!text) return false;
  // Fallback for tests/adapters that do not populate entities: match the
  // Telegram command shape including optional @bot suffix and arguments,
  // not arbitrary text that merely starts with '/'.
  return /^\/(?:[a-zA-Z0-9_]+)(?:@[\w]+)?(?:\s|$)/.test(text);
}

/**
 * Best-effort "processing" reaction on the user's message.
 *
 * If the reaction cannot be sent (unsupported chat, API error, or the context
 * does not expose the helper), the failure is logged and processing continues
 * normally. The user's request must never fail because of a reaction.
 */
async function sendProcessingReaction(ctx: Context, logger: Logger): Promise<void> {
  if (typeof ctx.react !== 'function') {
    return;
  }
  try {
    await ctx.react('👀');
  } catch (error) {
    logger.warn({ error }, 'Failed to send processing reaction');
  }
}

async function sendUnauthorized(
  ctx: Context,
  logger: Logger,
  audit?: AuditService,
): Promise<void> {
  logger.warn(
    { telegramUserId: ctx.from?.id, chatType: ctx.chat?.type },
    'Unauthorized Telegram access attempt',
  );
  audit?.record({
    userId: null,
    eventType: 'unauthorized_access',
    metadata: { telegramUserId: ctx.from?.id, chatType: ctx.chat?.type },
  });
  await ctx.reply(UNAUTHORIZED_MESSAGE);
}

export function registerTelegramHandlers(bot: Bot, deps: TelegramHandlersDeps): void {
  const { config, agentCore, sessionManager, logger, audit, userSettings } = deps;
  const allowedUserIds = config.TELEGRAM_ALLOWED_USER_IDS ?? [];

  bot.command('help', async (ctx) => {
    if (!isAuthorizedContext(ctx, allowedUserIds)) {
      await sendUnauthorized(ctx, logger, audit);
      return;
    }
    if (!isPrivateChat(ctx)) return;
    logger.info({ telegramUserId: ctx.from?.id }, '/help command');
    await ctx.reply(HELP_MESSAGE);
  });

  bot.command('status', async (ctx) => {
    if (!isAuthorizedContext(ctx, allowedUserIds)) {
      await sendUnauthorized(ctx, logger, audit);
      return;
    }
    if (!isPrivateChat(ctx)) return;
    logger.info({ telegramUserId: ctx.from?.id }, '/status command');
    const status =
      `Aktif.\n` +
      `Node env: ${config.NODE_ENV}\n` +
      `Log level: ${config.LOG_LEVEL}\n` +
      `Database: ${config.DATABASE_PATH}\n` +
      `Model: ${config.LLM_MODEL ?? 'not configured'}`;
    await ctx.reply(status);
  });

  bot.on('message:text', async (ctx) => {
    if (!isAuthorizedContext(ctx, allowedUserIds)) {
      await sendUnauthorized(ctx, logger, audit);
      return;
    }
    if (!isPrivateChat(ctx)) {
      logger.debug(
        { chatType: ctx.chat?.type, telegramUserId: ctx.from?.id },
        'Ignoring non-private message',
      );
      return;
    }

    if (isBotCommand(ctx)) {
      logger.debug({ text: ctx.message.text }, 'Ignoring bot command in message:text handler');
      return;
    }

    const text = ctx.message.text;
    const meta = getTelegramUserMeta(ctx);
    if (meta.telegramUserId === undefined) {
      logger.warn('Message without identifiable user');
      return;
    }

    logger.info(
      { telegramUserId: meta.telegramUserId, chatType: ctx.chat?.type },
      'Telegram message received',
    );

    try {
      await ctx.replyWithChatAction('typing');
      await sendProcessingReaction(ctx, logger);

      const user = await resolveAgentUser(
        meta.telegramUserId,
        meta.username,
        meta.displayName,
        sessionManager,
      );
      const session = await resolveSession(user, sessionManager);

      audit?.record({
        userId: user.id,
        eventType: 'session_start',
        metadata: { telegramUserId: meta.telegramUserId, sessionId: session.id },
      });

      const preferredModel = userSettings?.getModel(user.id);
      const runAgent = () =>
        agentCore.run({
          userId: user.id,
          sessionId: session.id,
          message: text,
        });

      const result = preferredModel
        ? await withModelOverride(preferredModel, runAgent)
        : await runAgent();

      const chunks = formatter.formatResponse(result.response, {
        finishReason: result.finishReason,
        toolCalls: result.toolCalls,
      });
      if (chunks.length === 0) {
        await ctx.reply('Agen tidak memberikan respons.');
        return;
      }

      for (const chunk of chunks) {
        if (chunk.parseMode) {
          await ctx.reply(chunk.text, { parse_mode: chunk.parseMode });
        } else {
          await ctx.reply(chunk.text);
        }
      }

      logger.info(
        {
          telegramUserId: meta.telegramUserId,
          sessionId: session.id,
          finishReason: result.finishReason,
          iterations: result.iterations,
        },
        'Telegram response sent',
      );
    } catch (error) {
      logger.error(
        { error, telegramUserId: meta.telegramUserId },
        'AgentCore run failed for Telegram message',
      );
      await ctx.reply('Maaf, terjadi kesalahan saat memproses permintaan Anda.');
    }
  });
}


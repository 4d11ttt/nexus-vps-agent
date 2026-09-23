import type { Context } from 'grammy';
import type { SessionManager } from '../agent/SessionManager.js';
import type { Session, User } from '../database/types.js';

/**
 * Resolve a Telegram user to an internal agent user using the existing
 * SessionManager/database layer.
 */
export async function resolveAgentUser(
  telegramUserId: number,
  username: string | undefined,
  displayName: string | undefined,
  sessionManager: SessionManager,
): Promise<User> {
  return sessionManager.ensureUser(String(telegramUserId), {
    username,
    displayName,
  });
}

/**
 * Resolve or continue a private-chat session for a Telegram user.
 *
 * The latest active session is reused so the conversation continues
 * naturally. Different Telegram users never share sessions.
 */
export async function resolveSession(
  user: User,
  sessionManager: SessionManager,
): Promise<Session> {
  const latest = await sessionManager.findLatestActiveSession(user.id);
  if (latest) return latest;
  return sessionManager.getOrCreateSession({ userId: user.id });
}

/**
 * Extract display metadata from a Telegram context for profile syncing.
 */
export function getTelegramUserMeta(ctx: Context): {
  telegramUserId: number | undefined;
  username: string | undefined;
  displayName: string | undefined;
} {
  const from = ctx.message?.from ?? ctx.callbackQuery?.from;
  if (!from) {
    return { telegramUserId: undefined, username: undefined, displayName: undefined };
  }
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || undefined;
  return {
    telegramUserId: from.id,
    username: from.username,
    displayName,
  };
}

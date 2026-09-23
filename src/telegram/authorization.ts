import type { Context } from 'grammy';

/**
 * Parse a comma-separated list of Telegram user IDs.
 *
 * Empty strings are treated as undefined. Non-numeric entries throw.
 */
export function parseAllowedUserIds(raw?: string): number[] | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
  if (ids.some((id) => Number.isNaN(id))) {
    throw new Error('Allowed user IDs must be numeric');
  }
  return ids.length === 0 ? undefined : ids;
}

/**
 * Extract the numeric Telegram user ID from a grammY context.
 *
 * Returns undefined when the update does not identify a user (e.g. channel posts).
 */
export function getTelegramUserId(ctx: Context): number | undefined {
  const from = ctx.message?.from ?? ctx.callbackQuery?.from;
  if (!from) return undefined;
  return from.id;
}

/**
 * Check whether a Telegram user ID is in the allow-list.
 */
export function isAuthorized(userId: number, allowedUserIds: number[]): boolean {
  return allowedUserIds.includes(userId);
}

/**
 * Convenience guard for grammY contexts.
 */
export function isAuthorizedContext(ctx: Context, allowedUserIds: number[]): boolean {
  const userId = getTelegramUserId(ctx);
  if (userId === undefined) return false;
  return isAuthorized(userId, allowedUserIds);
}

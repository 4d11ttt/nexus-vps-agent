const SAFE_CHUNK_LENGTH = 3800;

/**
 * Split a long response into Telegram-safe message chunks.
 *
 * - Respects Telegram's 4096 character limit.
 * - Splits at newline boundaries when possible to preserve readability.
 * - Falls back to a hard boundary if a single line exceeds the limit.
 * - Handles empty input safely.
 */
export function splitMessage(text: string, maxLength = SAFE_CHUNK_LENGTH): string[] {
  if (text.length === 0) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let cut = remaining.lastIndexOf('\n', maxLength);
    if (cut <= 0) {
      // No reasonable newline break; cut hard at the limit.
      cut = maxLength;
    }

    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, '');
  }

  return chunks;
}

/**
 * Escape Telegram MarkdownV2 special characters if MarkdownV2 is used.
 *
 * For Phase 6 the bot sends plain text; this helper is exported for future
 * formatting modes without pulling markup logic into handlers.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

# Telegram Integration

This document describes the Telegram integration implemented in Phase 6.

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_ENABLED` | No | Set to `true` to enable the Telegram bot. Defaults to `false`. |
| `TELEGRAM_BOT_TOKEN` | When enabled | Token from [@BotFather](https://t.me/botfather). Never commit this value. |
| `TELEGRAM_ALLOWED_USER_IDS` | When enabled | Comma-separated list of numeric Telegram user IDs that are allowed to use the bot. |

When `TELEGRAM_ENABLED` is `false`, the application starts without Telegram and existing tests continue to work.

## How Authorization Works

1. Every Telegram update is checked for an identifiable user.
2. The user's Telegram ID is matched against `TELEGRAM_ALLOWED_USER_IDS`.
3. Unauthorized users receive a short rejection message and never reach `AgentCore` or any internal tool.
4. The allowed ID list is never exposed in logs or replies.

## Obtaining and Configuring the Bot Token

1. Message [@BotFather](https://t.me/botfather) and create a new bot.
2. Copy the token (format: `123456789:ABC...`).
3. Export it as an environment variable or place it in `.env`:

```bash
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:ABC...
TELEGRAM_ALLOWED_USER_IDS=123456789
```

Never place the token in source code, documentation, or version control.

## Configuring Allowed User IDs

- Open Telegram, find your user ID (for example by messaging a bot like `@userinfobot`).
- Add the numeric ID(s) to `TELEGRAM_ALLOWED_USER_IDS` as a comma-separated list:

```bash
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321
```

There is no wildcard or "allow everyone" mode. If no IDs are configured and Telegram is enabled, the application refuses to start.

## Polling Behavior

- The bot uses grammY long polling via `TelegramBot.start()`.
- Polling runs until a `SIGINT` or `SIGTERM` signal is received.
- `TelegramBot.stop()` stops polling cleanly before the database connection is closed.

## Basic Commands

| Command | Purpose |
|---|---|
| `/start` | Brief introduction to the bot. |
| `/help` | Explains how to interact using natural language. |
| `/status` | Shows safe runtime status (node env, log level, database path, model name). No secrets are exposed. |

There are **no** Telegram commands for shell, filesystem, process, or package manager. Those are internal tools selected by the LLM.

## Private-Chat Scope

- Phase 6 supports private Telegram chats only.
- Group and supergroup messages are ignored cleanly.
- The session mapping is per Telegram user, so each user has a separate conversation history.

## Security Considerations

- Telegram is the outer security boundary. Authorization happens before `AgentCore.run()`.
- The bot token, LLM API key, and database credentials are never logged or sent in replies.
- Complete Telegram update objects are not logged. Only metadata such as user ID, chat type, session ID, and operation outcome are logged.
- `AgentCore` remains independent of Telegram; the Telegram adapter depends on `AgentCore`, not the reverse.

## Architecture

```
Telegram
  ↓
TelegramBot / handlers
  ↓
Authorization (allowed user IDs)
  ↓
SessionManager (existing database layer)
  ↓
AgentCore.run({ userId, sessionId, message })
  ↓
LLM → ToolRegistry → ToolExecutor → VPS tools
  ↓
Response → formatter → Telegram reply
```


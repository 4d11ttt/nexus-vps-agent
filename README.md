# NEXUS VPS Agent

> Autonomous Telegram Agent for Debian VPS

NEXUS is a lightweight Telegram-native agent designed to manage and automate
Debian VPS infrastructure through natural language.

NEXUS can:

- execute shell commands
- manage files
- inspect processes
- monitor system resources
- manage Debian packages
- maintain persistent memory
- use reusable skills
- schedule tasks
- record audit events
- operate through Telegram
- use a generic OpenAI-compatible LLM

## What It Is

- **Interface**: Telegram (grammY). Normal tasks work through natural language.
- **LLM**: one generic OpenAI-compatible provider.
- **Tools**: shell, filesystem, process, system, package manager, memory, skills,
  scheduler.
- **Persistence**: SQLite (WAL) for users, sessions, messages, tool calls,
  memories, skills, jobs, and audit events.
- **Workspace**: `SOUL.md`, `USER.md`, `MEMORY.md`, and `skills/`.

## Requirements

- Debian 12 x86_64 (production), or any OS with Node.js 22 for development
- Node.js 22
- pnpm (Corepack)
- TypeScript strict

## Installation

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

## Configuration

Copy `.env.example` to `.env` and fill in values. See `.env.example` for all
variables. Key groups:

- `LLM_API_BASE`, `LLM_API_KEY`, `LLM_MODEL` — LLM provider.
- `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` — Telegram.
- `SCHEDULER_ENABLED` — optional scheduler.
- `DATABASE_PATH`, `WORKSPACE_DIR` — storage locations.

Secrets come only from the environment; never commit them.

## Development

```bash
corepack pnpm dev        # run with tsx
corepack pnpm typecheck  # tsc --noEmit
corepack pnpm test       # vitest run
corepack pnpm build      # compile to dist/
```

## Testing

Tests never contact real Telegram or LLM APIs, install real packages, or modify
the host. They use mocks, temporary databases, and fake providers.

## Production Deployment

Build with `corepack pnpm build`, then run the compiled app under systemd. See
`docs/deployment.md` and `deploy/nexus-vps-agent.service`.

## Telegram Setup

1. Create a bot with [@BotFather](https://t.me/botfather).
2. Set `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN`, and
   `TELEGRAM_ALLOWED_USER_IDS` (comma-separated numeric user IDs).
3. Only authorized users can reach the agent.

## Root Access

The production agent intentionally runs with root access to manage the VPS.
Authorization is the security boundary, not filesystem sandboxing.

## Documentation

- `docs/architecture.md`
- `docs/telegram.md`
- `docs/llm.md`
- `docs/tools.md`
- `docs/memory.md`
- `docs/skills.md`
- `docs/scheduler.md`
- `docs/deployment.md`
- `docs/security.md`

## License

MIT

# Architecture

## System Flow

```
Telegram
  → Telegram Adapter (grammY)
  → Authorization (allowed user IDs)
  → Session Manager
  → AgentCore
  → Context Builder
  → LLM Provider (generic OpenAI-compatible)
  → Agent Loop
  → Tool Registry
  → Tool Executor
  → VPS Tools
      ├── shell
      ├── filesystem
      ├── process
      ├── system
      ├── package manager
      ├── memory
      ├── skills
      └── scheduler
  → Debian VPS
```

## Modules

| Module | Path | Responsibility |
|---|---|---|
| Telegram adapter | `src/telegram/` | grammY bot, authorization, commands, formatting. No agent logic. |
| Agent core | `src/agent/` | Agent loop, context building, tool registry/executor, sessions. Telegram-independent. |
| LLM provider | `src/llm/` | Generic OpenAI-compatible client. |
| Tools | `src/tools/` | Core VPS tools (shell, filesystem, process, system, package manager). |
| Memory | `src/memory/` | Workspace files + persistent per-user memory + memory tools. |
| Skills | `src/skills/` | Skill discovery, loading, and skill tools. |
| Scheduler | `src/scheduler/` | Persistent scheduled jobs + scheduler tools. |
| Audit | `src/audit/` | Security-relevant audit logging. |
| Database | `src/database/` | SQLite (WAL), migrations, repositories. |

## Supporting Systems

- **SQLite (WAL)** with migrations for users, sessions, messages, tool_calls,
  memories, skills, jobs, and audit_events.
- **Workspace** at `workspace/` containing `SOUL.md`, `USER.md`, `MEMORY.md`,
  `memory/`, and `skills/`.

## Design Rules

- AgentCore does not depend on grammY. Telegram is an adapter.
- Only one generic OpenAI-compatible LLM provider exists.
- Tools are internal agent capabilities, not Telegram commands.
- Telegram authorization is the outer security boundary.
- Root-level VPS access is intentional for the production target.

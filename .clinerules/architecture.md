# ARCHITECTURE.md

## System

Telegram
 -> Telegram Adapter
 -> Session Manager
 -> Agent Core
 -> Context Builder
 -> OpenAI-Compatible LLM
 -> Tool Calls
 -> Tool Registry
 -> Tool Executor
 -> VPS

## Modules

### TelegramAdapter
Handles Telegram updates, authorization, messages, typing/status, response formatting, and Telegram-specific errors.
Must not contain agent logic.

### AgentCore
Handles agent loop, context, tool calls, task state, iteration limits, and final response.

### LLMProvider
Generic OpenAI-compatible interface. AgentCore must not contain vendor-specific logic.

### ToolRegistry
Registers tools with name, description, schema, and execute function.

### ToolExecutor
Executes registered tools and normalizes results.

### MemoryManager
Handles SOUL.md, USER.md, MEMORY.md, history, persistent memory, search, and consolidation.

### SkillManager
Discovers, validates, loads, and manages SKILL.md skills.

### Database
Persists users, sessions, messages, tool calls, memories, jobs, skill metadata, and audit events.
Default: SQLite + WAL.

## Workspace

workspace/
├── SOUL.md
├── USER.md
├── MEMORY.md
├── memory/
└── skills/

## Deployment
Debian 12 x86_64, Node.js 22, pnpm, systemd.
Root execution is intentional for the current project.

# AGENTS.md

## Project
This project is a standalone autonomous Telegram AI Agent for Debian 12 x86_64.
It is inspired by Nanobot's architecture and capabilities, but the implementation is our own.

## Primary Objective
Build an autonomous agent capable of:
- natural-language task understanding
- multi-step planning
- tool execution
- failure diagnosis and recovery
- automatic dependency installation
- verification
- persistent memory
- reusable skills
- VPS management
- Telegram communication

The user should not need to provide shell commands for normal technical tasks.

## LLM
Use exactly ONE generic OpenAI-compatible provider abstraction.
Support:
- API base URL
- API key
- model name
- temperature
- max output tokens
- context window
- reasoning configuration when supported

Do not create separate provider implementations for individual vendors.

## Telegram
Use grammY.
Telegram is the primary interface.
Normal tasks must work through natural language. Internal tools are not exposed as required Telegram commands.

## Agent Loop
User message -> LLM -> tool call -> tool execution -> tool result -> LLM -> repeat or final response.

Continue until the task is completed, impossible to continue, a genuine authorization/information boundary is reached, or the iteration limit is reached.

## Autonomy
If a required package/tool is missing:
1. detect it
2. identify the correct package manager
3. install it
4. verify it
5. continue

If a command fails:
1. inspect the error
2. diagnose
3. attempt a reasonable correction
4. retry
5. verify

## Tools
Initial categories:
- shell
- filesystem
- process
- system
- package manager
- docker
- git
- network
- web
- scheduler
- memory
- skills

Tools are internal agent capabilities, not primary Telegram commands.

## Root
Root-level VPS access is intentional for the target deployment.
Do not artificially restrict the agent to a workspace directory.

## Memory
Required workspace files:
- SOUL.md
- USER.md
- MEMORY.md

Use SQLite for persistent operational data and history where appropriate.

## Skills
Skills use:
skills/<skill-name>/SKILL.md

They should contain purpose, when to use, prerequisites, workflow, verification, troubleshooting, and reusable patterns.

## Self-improvement
The agent may preserve genuinely reusable knowledge and create/update reusable skills after successful novel workflows. Do not record everything.

## Database
Use SQLite with WAL as the default.
Keep a database abstraction so MySQL/MariaDB can be added later without rewriting the agent core.

## Runtime
Target only:
- Debian 12
- x86_64/amd64
- Node.js 22
- pnpm
- TypeScript strict
- systemd

Do not add ARM/STB or multi-architecture deployment logic.

## Code Quality
Prefer small modules, explicit interfaces, dependency injection where useful, strict TypeScript, Zod validation, typed errors, structured logging, unit tests, and integration tests.

Avoid giant files, global mutable state, hidden side effects, duplicated logic, and unnecessary abstractions.

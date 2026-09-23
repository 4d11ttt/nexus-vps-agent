# WORKFLOW.md

## Development Workflow
Before coding:
1. inspect repository
2. inspect package.json
3. inspect tsconfig
4. inspect existing modules
5. inspect tests
6. identify missing architecture

Do not immediately generate large amounts of code.

## Implementation Order

### Phase 1
Project foundation:
- Node.js 22
- pnpm
- TypeScript strict
- configuration
- logging
- error handling

### Phase 2
Database:
- SQLite
- WAL
- migrations
- repository layer

### Phase 3
LLM:
- OpenAI-compatible client
- tool calling
- streaming if supported
- retry
- timeout
- context limits

### Phase 4
Agent Core:
- session
- context
- agent loop
- tool execution
- iteration limit

### Phase 5
Telegram:
- grammY
- authentication
- messages
- typing indicators
- long-message handling

### Phase 6
Core Tools:
- shell
- filesystem
- process
- system

### Phase 7
Infrastructure Tools:
- package managers
- Docker
- Git
- network
- HTTP

### Phase 8
Memory:
- SOUL.md
- USER.md
- MEMORY.md
- history
- persistent memory
- memory search
- consolidation

### Phase 9
Skills:
- discovery
- SKILL.md parser
- loader
- registry
- dynamic loading

### Phase 10
Autonomous Behavior:
- dependency detection
- automatic installation
- failure recovery
- verification
- reusable knowledge

### Phase 11
Scheduler:
- jobs
- recurring jobs
- execution
- cancellation

### Phase 12
MCP:
Implement after the core agent is stable.

### Phase 13
Testing:
- unit tests
- integration tests
- agent-loop tests
- tool tests
- Telegram tests

### Phase 14
Production:
- systemd
- environment configuration
- logging
- health checks
- backup
- graceful shutdown

## After Each Phase
Run:
pnpm typecheck
pnpm test
pnpm build

Fix failures before proceeding.

## Change Discipline
Prefer small coherent changes.
Do not rewrite unrelated modules.
Do not modify architecture without explaining why.
Keep the project buildable after each major phase.

# Memory

The agent has two complementary memory systems:

1. **Workspace files** — static identity/preference/knowledge files loaded into
   every system prompt: `workspace/SOUL.md`, `workspace/USER.md`,
   `workspace/MEMORY.md`.
2. **Persistent per-user memory** — durable facts stored in the SQLite
   `memories` table and managed through memory tools.

## Workspace Files

| File | Purpose |
|---|---|
| `SOUL.md` | Identity, behavior, priorities, communication style, tool-use principles. |
| `USER.md` | Stable user preferences and environment information. Never secrets. |
| `MEMORY.md` | Durable technical/project knowledge. Never secrets. |

These are loaded into the system prompt on every run. Keep them concise.

## Persistent Memory Tools

| Tool | Purpose |
|---|---|
| `memory_search` | Search durable facts by keyword. |
| `memory_save` | Save (or upsert) a durable fact by key. |
| `memory_update` | Update an existing fact by key. |
| `memory_delete` | Delete a fact by key. |

All operations are scoped to the authenticated user via `ToolContext.userId`.

## Context Loading Limits

- `MEMORY_MAX_RESULTS` (default `5`) — max number of relevant memories injected.
- `MEMORY_CONTEXT_LIMIT` (default `4000`) — max characters of memory context.

Relevant memories are selected by a case-insensitive keyword match against the
current user message and injected into the system prompt. The agent decides when
durable memory is useful; conversation messages are **not** automatically saved
as permanent memory.

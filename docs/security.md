# Security Model

The agent intentionally has root-level VPS access. Security focuses on **who** can
reach the agent and **validating tool inputs**, not on restricting the agent to a
sandbox.

## Authorization Boundary

Telegram user authorization is the outer security boundary. Authorization happens
**before**:

- agent invocation
- tool invocation
- memory access
- filesystem access

`TELEGRAM_ALLOWED_USER_IDS` is a comma-separated allow-list. There is no
"allow everyone" mode; an empty list with Telegram enabled refuses to start.

## Secrets

Secrets (bot token, LLM API key, database credentials, passwords) must come from
environment variables. They are never written to source code, `SOUL.md`,
`USER.md`, `MEMORY.md`, `SKILL.md`, logs, the database, or Telegram responses.

The logger redacts common secret fields (`token`, `key`, `secret`, `password`,
`authorization`, `cookie`).

## Tool Inputs

LLM-generated tool arguments are treated as untrusted input and validated with
Zod before execution.

- **Shell**: validated command, timeout, output truncation, process-tree
  termination, no secret logging.
- **Filesystem**: deterministic absolute path resolution; writes/edits refuse to
  follow symlinks.
- **Network**: explicit timeouts (in the LLM provider).
- **Scheduler**: jobs are scoped to their owner; notifications are only sent to
  authorized Telegram users.

## Audit

`audit_events` records security-relevant events (unauthorized access, session
start, tool invocation/failure, scheduler create/cancel, config failures) without
secrets or full message contents.

## Not Logged

- bot tokens, LLM API keys, passwords, authorization headers
- full environment variables
- full Telegram update objects
- full prompts/responses by default

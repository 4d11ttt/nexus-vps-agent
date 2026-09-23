# SECURITY.md

The project intentionally has root-level VPS capabilities.

Security focuses on controlling who can access the agent and validating tool inputs.

## Telegram Authorization
Authorize before:
- agent invocation
- tool invocation
- memory access
- filesystem access

## Secrets
Never put secrets in source code, SOUL.md, USER.md, MEMORY.md, SKILL.md, Git, logs, or Telegram responses.
Use environment variables or a secure secret mechanism.

## Tool Inputs
Treat LLM-generated tool arguments as untrusted input. Validate every tool input.

## Shell
Shell execution must:
- validate input
- enforce timeout
- capture output
- handle signals
- prevent uncontrolled process spawning
- record execution metadata

Do not silently modify commands.

## Filesystem
Protect against malformed paths and unintended path resolution.
Broad filesystem access is intentional, but path handling must remain deterministic.

## Network
Use explicit timeouts.

## Audit
Record important actions such as tool, timestamp, result, and duration without recording secrets.

## Confirmation
Do not add unnecessary confirmation prompts for ordinary administrative tasks. The agent is designed for autonomous operation.

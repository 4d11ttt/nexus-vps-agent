# MCP (Model Context Protocol)

MCP is treated as an **optional extension point** and is disabled by default
(`MCP_ENABLED=false`).

## Status

Not implemented. The core agent does not require MCP, and adding an MCP client
would pull in external dependencies and a second tool-execution path that could
destabilize the existing, stable `ToolRegistry`.

## Extension Point

If MCP is added later, it must:

- expose tools through the existing `ToolRegistry` (no second execution system);
- validate external tool schemas with Zod;
- isolate MCP failures from the core agent;
- not bypass Telegram authorization;
- keep server configuration in environment variables only.

The `MCP_ENABLED` flag and `src/scheduler/tools.ts`/`src/tools/index.ts`
registration patterns show where new tool groups are wired in.

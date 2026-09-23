# Real VPS Tool System

This document describes the internal tool system introduced in Phase 5. Tools are **internal agent capabilities**; they are not exposed as Telegram commands. The LLM chooses which tool to use based on the task and the tool descriptions.

## Architecture

```
src/tools/
├── context.ts              # ToolContext interface
├── index.ts                # registerCoreTools()
├── shell/                  # shell tool
├── filesystem/             # filesystem_* tools
├── process/                # process_* tools
├── system/                 # system_* tools
└── package-manager/        # package_manager tool
```

`ToolRegistry` (from `src/agent/ToolRegistry.ts`) holds all tools. `AgentCore` accepts a registry via dependency injection, so the agent core stays decoupled from individual tool implementations.

## ToolContext

Every tool receives exactly one object:

```ts
interface ToolContext {
  logger: Logger;
  config: Config;
  userId: number;
  sessionId: number;
  abortSignal?: AbortSignal;
}
```

Tools do **not** receive `AgentCore`, the database, or Telegram objects. This keeps tools portable and easy to test.

## Shell Tool

- **Name:** `shell`
- **Input:** `command`, optional `cwd`, `timeoutMs`, `env`, `stdin`
- **Output:** `exitCode`, `stdout`, `stderr`, `durationMs`, `timedOut`

Runs the command in a fresh process using Node.js `spawn`. Default timeout is `TOOL_SHELL_TIMEOUT_MS` (300 000 ms / 5 minutes). Each stdout/stderr stream is limited to `TOOL_MAX_OUTPUT_BYTES` (1 MiB by default). Oversized output is truncated and a marker such as `[output truncated: 136 bytes omitted]` is appended.

The shell supports cancellation through `ToolContext.abortSignal` and the internal timeout. It works on both Windows (`cmd.exe /c`) and Debian (`/bin/sh -c`) during development, but the production target is Debian 12.

## Filesystem Tools

All paths are resolved to absolute paths with Node.js `path.resolve`. The tools are symlink-aware but do not blindly follow symbolic links: writes and edits through symlinks are rejected, while reads and stats report symlink information.

| Tool | Purpose |
|------|---------|
| `filesystem_read` | Read a text file. |
| `filesystem_write` | Write a file, creating parent directories. |
| `filesystem_edit` | Replace exactly one occurrence; fails on missing or ambiguous matches. |
| `filesystem_list` | List directory entries with type, size, and mtime. |
| `filesystem_stat` | Return metadata including symlink target. |
| `filesystem_search` | Search by name/content with bounded depth and result count. |
| `filesystem_delete` | Delete a file, symlink, or directory. |
| `filesystem_mkdir` | Create directories recursively. |

## Process Tools

- `process_list` — List running processes (Linux; pid, ppid, user, command, state, memory).
- `process_inspect` — Inspect a single process by PID.
- `process_kill` — Send a signal to a process (default `SIGTERM`).

On Windows these tools return a structured unsupported result because the production target is Debian 12.

## System Tools

These wrap Node.js `os` and expose quick answers to questions such as "cek RAM VPS":

- `system_info`
- `system_resources`
- `system_uptime`
- `system_hostname`
- `system_os`

They return hostname, platform, architecture, kernel release, CPU count, memory total/free/used, uptime, and load average when available.

## Package Manager Tool

- **Name:** `package_manager`
- **Actions:** `check`, `install`, `remove`, `update`

Detects the platform. On Debian/Ubuntu it uses `dpkg-query` and `apt-get`. On Windows it returns a structured unsupported result and never runs apt.

This enables autonomous behavior such as:

1. User: "install nginx"
2. Agent: `package_manager check nginx` → missing
3. Agent: `package_manager install nginx` → success
4. Agent: verify with `shell systemctl status nginx`

## Error Handling

A tool failure is returned as a `ToolResult` with `success: false` and an `error` string. The AgentCore adds the error to the LLM context so the model can decide how to recover (for example, installing a missing dependency after a "command not found" error). Tool exceptions are caught by `ToolExecutor` and never crash the agent.

## Audit

Tool calls are persisted through `SessionManager.addToolCall` using the repository layer from Phase 2. The record includes tool name, arguments, result, status, duration, and timestamp. Secrets are never logged or stored.

## Platform Behavior

| Platform | Shell | Filesystem | Process | Package Manager |
|----------|-------|------------|---------|-----------------|
| Debian 12 | `/bin/sh -c` | full access | `/proc` based | `apt-get`/`dpkg-query` |
| Windows (dev) | `cmd.exe /c` | full access | unsupported | unsupported |

The codebase typechecks, tests, and builds on both platforms; Linux-specific execution paths are isolated inside the tools.

# Deployment (Debian 12 x86_64)

The primary deployment target is native Node.js + systemd on Debian 12 x86_64.
Docker is **not** required.

## Prerequisites

- Debian 12 x86_64/amd64
- Node.js 22
- pnpm (via Corepack)
- root access (intentional)

## Build

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

`pnpm build` compiles TypeScript to `dist/` using `tsconfig.build.json`.

## Configure

Copy `.env.example` to `.env` and fill in the required values. Alternatively use
systemd `EnvironmentFile`.

Required for Telegram: `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_ALLOWED_USER_IDS`, and the `LLM_*` values.

## Directory Layout

| Path | Purpose |
|---|---|
| `/opt/nexus-vps-agent/` | Application (source + `dist/`). |
| `/opt/nexus-vps-agent/.env` | Environment file (mode `600`, root-owned). |
| `/opt/nexus-vps-agent/data/` | SQLite database (WAL). |
| `/opt/nexus-vps-agent/workspace/` | SOUL.md, USER.md, MEMORY.md, skills/. |
| `/var/log/nexus-vps-agent/` | stdout/stderr captured by journald (or file). |

## systemd

Install the unit:

```bash
cp deploy/nexus-vps-agent.service /etc/systemd/system/nexus-vps-agent.service
systemctl daemon-reload
systemctl enable --now nexus-vps-agent
```

Useful commands:

```bash
systemctl status nexus-vps-agent
journalctl -u nexus-vps-agent -f
systemctl restart nexus-vps-agent
```

## Restart & Shutdown

- `Restart=on-failure` restarts the service on crashes.
- The application handles `SIGINT`/`SIGTERM` for graceful shutdown: it stops the
  scheduler and Telegram polling, then closes the database.

## Health

- `systemctl is-active nexus-vps-agent` should print `active`.
- Logs use structured JSON at `LOG_LEVEL=info` in production.

# Scheduler

The scheduler runs inside the application process and persists jobs in the
SQLite `jobs` table, so jobs survive process restarts.

## Job Model

| Field | Description |
|---|---|
| `name` | Short label. |
| `schedule` | JSON: `{"type":"once","at":"ISO timestamp"}` or `{"type":"interval","intervalMs":number}`. |
| `payload` | JSON: `{"instruction":"natural-language task","notify":bool}`. |
| `enabled` | 1 = enabled, 0 = cancelled/completed. |
| `status` | `pending`, `active`, `running`, `completed`, `failed`, `cancelled`. |
| `next_run_at` / `last_run_at` / `last_result` / `run_count` | Execution tracking. |

## Behavior

- A polling timer (`SCHEDULER_POLL_INTERVAL_MS`, default 30s) finds due jobs.
- Jobs are claimed atomically (single `UPDATE ... WHERE status != 'running'`) to
  prevent duplicate execution.
- A job's natural-language instruction is executed through `AgentCore`, not by
  calling the LLM directly from scheduler code.
- One-time jobs are marked `completed` and disabled after running; interval jobs
  are rescheduled and stay enabled.
- Failures are recorded and never crash the scheduler.

## Tools

| Tool | Purpose |
|---|---|
| `schedule_create` | Create a one-time or interval job. |
| `schedule_list` | List the user's jobs. |
| `schedule_cancel` | Cancel a job owned by the user. |

## Telegram Notifications

When a job has `notify: true`, the result is delivered to the job owner's
Telegram chat. The Telegram adapter enforces the same authorization boundary,
so notifications can never be sent to arbitrary unauthorized destinations.

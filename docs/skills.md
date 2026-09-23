# Skills

Skills are reusable instructions/workflow knowledge, **not** executable code.

## Layout

```
workspace/skills/
  <skill-name>/
    SKILL.md
```

## SKILL.md Format

A skill may contain optional front matter with a `description`:

```markdown
---
description: Manage system services
---
# System Admin

Purpose, when to use, prerequisites, workflow, verification, troubleshooting.
```

When no front matter is present, the description is taken from the first
non-empty, non-heading line.

## Tools

| Tool | Purpose |
|---|---|
| `skill_list` | List available skills (name + description). |
| `skill_read` | Load the full `SKILL.md` content of one skill. |

## Context Strategy

Only a compact index of skill names and descriptions is injected into the system
prompt. Full skill content is loaded on demand via `skill_read`, so the default
context does not grow with every skill. `SKILL.md` contents are never executed
as code.

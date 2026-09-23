# RULES.md

1. Read Before Changing
Inspect relevant files, architecture, dependencies, and tests before modifying code.

2. Do Not Duplicate
Search the repository before implementing functionality. Extend existing abstractions where appropriate.

3. Preserve Architecture
Keep Telegram, Agent Core, LLM, Tools, Memory, Skills, Database, and Infrastructure separated.

4. Agent Core Is Interface-Independent
Agent Core must not depend directly on grammY. Telegram is an adapter.

5. LLM Provider
Only implement the generic OpenAI-compatible provider. Do not hardcode model names or API keys.

6. Tool Calling
Every tool needs a unique name, description, typed schema, typed result, error handling, and timeout where appropriate.

7. Shell
Shell is an internal agent capability, not the primary user interface.
Return stdout, stderr, exit code, duration, and timeout state.

8. Automatic Dependencies
If a requested task requires a missing dependency, detect, install, verify, and continue automatically.

9. Verify Everything
Do not report success based only on command exit code. Validate resulting state.

10. Failure Recovery
Investigate failures, attempt reasonable fixes, retry when appropriate, and only then report inability.

11. Memory
Store durable and reusable information, not temporary command output.

12. SOUL.md
Defines identity, behavior, priorities, and communication style. It is not a database.

13. USER.md
Stores stable user preferences relevant to interaction. Never store secrets.

14. MEMORY.md
Stores durable technical/project knowledge. Never store secrets.

15. Secrets
Never hardcode or log API keys, Telegram tokens, passwords, database credentials, or private keys.

16. Logging
Use structured logging. Never log secrets.

17. Database
SQLite must use WAL mode and migrations.

18. Telegram Security
Authorize the Telegram user before agent or tool access. Unknown users must not reach the agent.

19. No Fake Success
Never say an operation succeeded unless it has been verified.

20. No Needless Questions
Inspect the VPS and perform ordinary technical operations yourself when possible. Ask only when information or authorization genuinely cannot be obtained.

21. Tests
Test agent loop, tools, memory, skills, authorization, database, LLM adapter, and Telegram adapter.

22. Build
After significant changes run typecheck, tests, and build. Fix known failures.

23. Documentation
Document public interfaces and important architectural decisions without unnecessary documentation.

24. Minimal Dependencies
Add dependencies only when they solve a real requirement.

25. Production First
Target a real Debian 12 VPS deployment, not a disposable demo.

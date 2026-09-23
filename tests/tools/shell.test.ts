import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { runShell } from '../../src/tools/shell/executor.js';
import { shellTool } from '../../src/tools/shell/tool.js';
import { loadConfig } from '../../src/config.js';
import type { ToolContext } from '../../src/tools/context.js';
import type { Config } from '../../src/config.js';

function createConfig(overrides: Partial<Config> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: './data/agent.db',
    TOOL_SHELL_TIMEOUT_MS: '300000',
    TOOL_MAX_OUTPUT_BYTES: String(overrides.TOOL_MAX_OUTPUT_BYTES ?? 1_048_576),
  });
}

function createContext(config = createConfig()): ToolContext {
  return {
    userId: 1,
    sessionId: 1,
    logger: pino({ level: 'silent' }),
    config,
  };
}

describe('runShell', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexus-shell-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('captures stdout from a simple command', async () => {
    const result = await runShell({ command: 'node -e "console.log(\'hello\')"' }, createContext());
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr separately', async () => {
    const result = await runShell({ command: 'node -e "console.error(\'warn\')"' }, createContext());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe('warn');
  });

  it('returns the command exit code', async () => {
    const result = await runShell({ command: 'node -e "process.exit(7)"' }, createContext());
    expect(result.exitCode).toBe(7);
  });

  it('returns a non-zero exit code for a command that does not exist', async () => {
    const result = await runShell(
      { command: 'definitely_not_a_real_command_xyz' },
      createContext(),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('runs the command in the requested working directory', async () => {
    const result = await runShell(
      { command: 'node -e "console.log(process.cwd())"', cwd: tempDir },
      createContext(),
    );
    expect(resolve(result.stdout.trim())).toBe(resolve(tempDir));
  });

  it('pipes stdin to the command', async () => {
    const result = await runShell(
      {
        command: 'node -e "process.stdin.on(\'data\', d=>console.log(d.toString().trim().toUpperCase()))"',
        stdin: 'hello world',
      },
      createContext(),
    );
    expect(result.stdout.trim()).toBe('HELLO WORLD');
  });

  it('sets extra environment variables', async () => {
    const result = await runShell(
      { command: 'node -e "console.log(process.env.NEXUS_TEST_VAR)"', env: { NEXUS_TEST_VAR: '42' } },
      createContext(),
    );
    expect(result.stdout.trim()).toBe('42');
  });

  it('times out a long-running command', async () => {
    const result = await runShell(
      { command: 'node -e "setTimeout(() => {}, 2000)"', timeoutMs: 100 },
      createContext(),
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(null);
    expect(result.durationMs).toBeGreaterThanOrEqual(80);
  });

  it('respects an external abort signal', async () => {
    const controller = new AbortController();
    const promise = runShell(
      { command: 'node -e "setTimeout(() => {}, 2000)"' },
      { ...createContext(), abortSignal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.exitCode).toBe(null);
    expect(result.timedOut).toBe(false);
  });

  it('truncates oversized stdout and reports omitted bytes', async () => {
    const config = createConfig({ TOOL_MAX_OUTPUT_BYTES: 64 });
    const result = await runShell(
      { command: 'node -e "console.log(\'A\'.repeat(200))"' },
      createContext(config),
    );
    expect(result.stdout).toContain('[output truncated:');
    expect(result.stdout).toContain('137 bytes omitted');
    expect(result.stdout).not.toHaveLength(200);
  });
});

describe('shellTool', () => {
  it('returns a JSON-encoded ShellResult', async () => {
    const ctx = createContext();
    const output = await shellTool.execute({ command: 'node -e "console.log(1+1)"' }, ctx);
    const parsed = JSON.parse(output);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout.trim()).toBe('2');
  });
});

import { spawn } from 'node:child_process';
import type { ToolContext } from '../context.js';
import type { ShellInput, ShellResult } from './types.js';

interface StreamState {
  buffers: Buffer[];
  received: number;
  kept: number;
  truncated: boolean;
}

const isWindows = process.platform === 'win32';

function terminateChild(child: ReturnType<typeof spawn>): void {
  if (child.killed || child.pid === undefined) return;
  try {
    if (isWindows) {
      // On Windows, killing the shell often leaves the spawned command alive.
      // taskkill /T /F walks the process tree so the real command is terminated.
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else {
      // Negative PID kills the whole process group created by detached spawn.
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // Fall back to killing the immediate child process.
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

export async function runShell(
  input: ShellInput,
  ctx: ToolContext,
): Promise<ShellResult> {
  const start = Date.now();
  const maxOutputBytes = ctx.config.TOOL_MAX_OUTPUT_BYTES;
  const timeoutMs = input.timeoutMs ?? ctx.config.TOOL_SHELL_TIMEOUT_MS;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort('timeout'), timeoutMs);

  const child = spawn(input.command, {
    shell: true,
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: !isWindows,
  });

  const stdout: StreamState = { buffers: [], received: 0, kept: 0, truncated: false };
  const stderr: StreamState = { buffers: [], received: 0, kept: 0, truncated: false };
  let killedByAbort = false;

  const maybeKill = () => {
    killedByAbort = true;
    terminateChild(child);
  };

  const onTimeoutAbort = () => maybeKill();
  timeoutController.signal.addEventListener('abort', onTimeoutAbort);

  let externalAbortHandler: (() => void) | undefined;
  if (ctx.abortSignal) {
    externalAbortHandler = () => maybeKill();
    if (ctx.abortSignal.aborted) {
      maybeKill();
    } else {
      ctx.abortSignal.addEventListener('abort', externalAbortHandler);
    }
  }

  const handleChunk = (state: StreamState, chunk: Buffer) => {
    state.received += chunk.length;
    if (state.truncated) return;
    const remaining = maxOutputBytes - state.kept;
    if (chunk.length <= remaining) {
      state.buffers.push(chunk);
      state.kept += chunk.length;
      return;
    }
    if (remaining > 0) {
      state.buffers.push(chunk.subarray(0, remaining));
      state.kept += remaining;
    }
    state.truncated = true;
  };

  child.stdout?.on('data', (chunk: Buffer) => handleChunk(stdout, chunk));
  child.stderr?.on('data', (chunk: Buffer) => handleChunk(stderr, chunk));

  if (input.stdin !== undefined) {
    child.stdin?.write(input.stdin);
    child.stdin?.end();
  }

  return new Promise<ShellResult>((resolve) => {
    child.on('error', () => {
      cleanup();
      resolve(
        buildResult(
          start,
          stdout,
          stderr,
          null,
          killedByAbort || timeoutController.signal.aborted,
          timeoutController.signal.reason === 'timeout',
        ),
      );
    });

    child.on('close', (exitCode) => {
      cleanup();
      resolve(
        buildResult(
          start,
          stdout,
          stderr,
          exitCode ?? null,
          killedByAbort,
          timeoutController.signal.reason === 'timeout',
        ),
      );
    });
  });

  function cleanup() {
    clearTimeout(timeoutId);
    timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
    if (ctx.abortSignal && externalAbortHandler) {
      ctx.abortSignal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

function buildResult(
  start: number,
  stdout: StreamState,
  stderr: StreamState,
  exitCode: number | null,
  aborted: boolean,
  timedOut: boolean,
): ShellResult {
  return {
    exitCode: aborted ? null : exitCode,
    stdout: buildOutput(stdout),
    stderr: buildOutput(stderr),
    durationMs: Date.now() - start,
    timedOut,
  };
}

function buildOutput(state: StreamState): string {
  const text = Buffer.concat(state.buffers).toString('utf-8');
  if (!state.truncated) return text;
  const omitted = Math.max(0, state.received - state.kept);
  return `${text}\n[output truncated: ${omitted} bytes omitted]`;
}


import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import { loadConfig } from '../../src/config.js';
import { packageManagerTool } from '../../src/tools/package-manager/tool.js';
import type { ToolContext } from '../../src/tools/context.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter: EE } = await import('node:events');

  let checkStatus = 'ii\n';
  let aptExitCode = 0;

  function createMockChild(command: string, _args: string[]) {
    const stdout = new EE();
    const stderr = new EE();
    const child = new EE() as unknown as import('node:child_process').ChildProcess;
    Object.assign(child, {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(),
    });

    setImmediate(() => {
      if (command === 'dpkg-query') {
        stdout.emit('data', Buffer.from(checkStatus));
      }
      (child as unknown as EventEmitter).emit('close', aptExitCode);
    });

    return child;
  }

  const spawn = vi.fn().mockImplementation((command: string, _args: string[]) =>
    createMockChild(command, _args),
  );

  return {
    ...actual,
    spawn,
    __setCheckStatus: (status: string) => {
      checkStatus = status;
    },
    __setAptExitCode: (code: number) => {
      aptExitCode = code;
    },
  };
});

function createContext(): ToolContext {
  return {
    userId: 1,
    sessionId: 1,
    logger: pino({ level: 'silent' }),
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: './data/agent.db',
    }),
  };
}

describe('package_manager tool', () => {
  const ctx = createContext();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unsupported on Windows without running apt', async () => {
    if (process.platform !== 'win32') {
      // This assertion is specific to Windows development.
      return;
    }
    const output = JSON.parse(
      await packageManagerTool.execute({ action: 'check', package: 'nginx' }, ctx),
    );
    expect(output.supported).toBe(false);
    expect(output.error).toContain('not supported');
  });

  it('reports installed when dpkg-query returns ii', async () => {
    const cp = await import('node:child_process');
    const { __setCheckStatus } = cp as unknown as {
      __setCheckStatus: (s: string) => void;
    };
    __setCheckStatus('ii\n');

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    const output = JSON.parse(
      await packageManagerTool.execute({ action: 'check', package: 'nginx' }, ctx),
    );
    expect(output.installed).toBe(true);
    expect(output.package).toBe('nginx');
  });

  it('reports not installed when dpkg-query fails', async () => {
    const cp = await import('node:child_process');
    const { __setCheckStatus } = cp as unknown as {
      __setCheckStatus: (s: string) => void;
    };
    __setCheckStatus('');

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    const output = JSON.parse(
      await packageManagerTool.execute({ action: 'check', package: 'nginx' }, ctx),
    );
    expect(output.installed).toBe(false);
  });

  it('installs a package via apt-get', async () => {
    const cp = await import('node:child_process');
    const { __setAptExitCode } = cp as unknown as {
      __setAptExitCode: (c: number) => void;
    };
    __setAptExitCode(0);

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    const output = JSON.parse(
      await packageManagerTool.execute({ action: 'install', package: 'nginx' }, ctx),
    );
    expect(output.success).toBe(true);
    expect(output.package).toBe('nginx');
  });
});

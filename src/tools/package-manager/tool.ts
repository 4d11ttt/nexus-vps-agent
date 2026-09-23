import { z } from 'zod';
import { spawn } from 'node:child_process';
import type { Tool } from '../../agent/types.js';
import type { ToolContext } from '../context.js';
import type { CommandResult } from './types.js';

function isWindows(): boolean {
  return process.platform === 'win32';
}

function runCommand(
  command: string,
  args: string[],
  env: Record<string, string> = {},
  timeoutMs = 300_000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: exitCode ?? null,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}

async function checkPackage(pkg: string): Promise<string> {
  const result = await runCommand('dpkg-query', [
    '-W',
    '-f=${db:Status-Abbrev}\\n',
    pkg,
  ]);
  const status = result.stdout.trim();
  const installed = result.exitCode === 0 && status.startsWith('ii');
  return JSON.stringify({
    package: pkg,
    installed,
    status,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  });
}

async function installPackage(
  pkg: string,
  updateMetadata: boolean,
  ctx: ToolContext,
): Promise<string> {
  if (updateMetadata) {
    ctx.logger.info('Updating apt metadata before install');
    await runCommand('apt-get', ['update']);
  }
  const result = await runCommand('apt-get', ['install', '-y', pkg], {
    DEBIAN_FRONTEND: 'noninteractive',
  });
  return JSON.stringify({
    package: pkg,
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

async function removePackage(pkg: string): Promise<string> {
  const result = await runCommand('apt-get', ['remove', '-y', pkg], {
    DEBIAN_FRONTEND: 'noninteractive',
  });
  return JSON.stringify({
    package: pkg,
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

async function updateMetadata(): Promise<string> {
  const result = await runCommand('apt-get', ['update']);
  return JSON.stringify({
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function unsupportedResult(action?: string): string {
  return JSON.stringify({
    success: false,
    supported: false,
    error: `package_manager is not supported on ${process.platform}. The production VPS runs Debian 12 x86_64 with apt.`,
    action,
  });
}

const packageManagerInputSchema = z.object({
  action: z.enum(['check', 'install', 'remove', 'update']),
  package: z.string().min(1).optional(),
  updateMetadata: z.boolean().optional(),
});

export const packageManagerTool: Tool = {
  name: 'package_manager',
  description:
    'Manage Debian/Ubuntu system packages using apt. On the production Debian VPS it can check whether a package is installed, install it, remove it, or update package metadata. This tool is not available on Windows.',
  parameters: packageManagerInputSchema,
  parameterSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['check', 'install', 'remove', 'update'],
        description: 'Action to perform',
      },
      package: { type: 'string', description: 'Package name (required for check/install/remove)' },
      updateMetadata: { type: 'boolean', description: 'Run apt-get update before install' },
    },
    required: ['action'],
  },
  execute: async (args, ctx) => {
    const input = packageManagerInputSchema.parse(args);
    if (isWindows()) {
      return unsupportedResult(input.action);
    }
    switch (input.action) {
      case 'check': {
        if (!input.package) {
          throw new Error('package is required for action "check"');
        }
        return checkPackage(input.package);
      }
      case 'install': {
        if (!input.package) {
          throw new Error('package is required for action "install"');
        }
        return installPackage(input.package, input.updateMetadata ?? false, ctx);
      }
      case 'remove': {
        if (!input.package) {
          throw new Error('package is required for action "remove"');
        }
        return removePackage(input.package);
      }
      case 'update':
        return updateMetadata();
      default:
        throw new Error(`Unsupported package manager action: ${input.action satisfies never}`);
    }
  },
};

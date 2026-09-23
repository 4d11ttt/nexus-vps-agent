import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import type { Tool } from '../../agent/types.js';
import type { ProcessInspectInput, ProcessKillInput, ProcessListInput } from './types.js';

const isWindows = process.platform === 'win32';

interface ProcessInfo {
  pid: number;
  ppid: number;
  user?: string;
  command: string;
  state?: string;
  cpu?: number;
  memory?: number;
}

async function readProcFile(pid: number, file: string): Promise<string> {
  return readFile(`/proc/${pid}/${file}`, 'utf-8').catch(() => '');
}

function parseStatus(statusText: string): { uid?: string; vmRss?: number } {
  const uidLine = statusText.split('\n').find((l) => l.startsWith('Uid:'));
  const vmRssLine = statusText.split('\n').find((l) => l.startsWith('VmRSS:'));
  const uid = uidLine ? uidLine.split(/\s+/)[1] : undefined;
  const vmRss = vmRssLine
    ? Number.parseInt(vmRssLine.split(/\s+/)[1], 10) * 1024
    : undefined;
  return { uid, vmRss };
}

function parseStat(statText: string): { ppid?: number; state?: string } {
  // comm may contain spaces and parentheses; extract fields after the last ')'.
  const close = statText.lastIndexOf(')');
  if (close === -1) return {};
  const fields = statText.slice(close + 2).split(' ');
  return {
    state: fields[0],
    ppid: Number.parseInt(fields[1], 10),
  };
}

async function listProcessesLinux(): Promise<ProcessInfo[]> {
  const results: ProcessInfo[] = [];
  const entries = await readdir('/proc').catch(() => [] as string[]);
  for (const entry of entries) {
    const pid = Number.parseInt(entry, 10);
    if (Number.isNaN(pid)) continue;
    const [statText, statusText, cmdline] = await Promise.all([
      readProcFile(pid, 'stat'),
      readProcFile(pid, 'status'),
      readProcFile(pid, 'cmdline'),
    ]);
    const stat = parseStat(statText);
    const status = parseStatus(statusText);
    const command = cmdline.replace(/\0/g, ' ').trim() || statText.split(' ')[1]?.slice(1, -1) || entry;
    results.push({
      pid,
      ppid: stat.ppid ?? 0,
      user: status.uid,
      command,
      state: stat.state,
      memory: status.vmRss,
    });
  }
  return results;
}

async function list(_input: ProcessListInput) {
  if (isWindows) {
    return JSON.stringify({
      processes: [],
      note: 'process_list is not supported on Windows. Run on the Debian VPS for full process information.',
    });
  }
  const processes = await listProcessesLinux();
  return JSON.stringify({ count: processes.length, processes });
}

async function inspect(input: ProcessInspectInput) {
  if (isWindows) {
    return JSON.stringify({ error: 'process_inspect is not supported on Windows' });
  }
  const [statText, statusText, cmdline] = await Promise.all([
    readProcFile(input.pid, 'stat'),
    readProcFile(input.pid, 'status'),
    readProcFile(input.pid, 'cmdline'),
  ]);
  const stat = parseStat(statText);
  const status = parseStatus(statusText);
  const command = cmdline.replace(/\0/g, ' ').trim() || statText.split(' ')[1]?.slice(1, -1) || String(input.pid);
  return JSON.stringify({
    pid: input.pid,
    ppid: stat.ppid,
    state: stat.state,
    user: status.uid,
    memory: status.vmRss,
    command,
  });
}

async function kill(input: ProcessKillInput) {
  if (isWindows) {
    return JSON.stringify({ error: 'process_kill is not supported on Windows' });
  }
  const signal = input.signal ?? 'SIGTERM';
  try {
    process.kill(input.pid, signal as NodeJS.Signals);
    return JSON.stringify({ success: true, pid: input.pid, signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ success: false, pid: input.pid, error: message });
  }
}

export const processListTool: Tool = {
  name: 'process_list',
  description:
    'List running processes on the VPS. On Linux/Debian it returns pid, ppid, user, command, state, and memory. On Windows it returns an empty list because this tool targets the production VPS.',
  parameters: z.object({}),
  parameterSchema: { type: 'object', properties: {} },
  execute: async () => list({}),
};

export const processInspectTool: Tool = {
  name: 'process_inspect',
  description: 'Inspect a single process by PID. Linux/Debian only.',
  parameters: z.object({ pid: z.number().int().positive() }),
  parameterSchema: { type: 'object', properties: { pid: { type: 'number' } }, required: ['pid'] },
  execute: async (args) => inspect({ pid: Number((args as { pid: unknown }).pid) }),
};

export const processKillTool: Tool = {
  name: 'process_kill',
  description: 'Send a signal to a process by PID. Defaults to SIGTERM. Linux/Debian only.',
  parameters: z.object({ pid: z.number().int().positive(), signal: z.string().optional() }),
  parameterSchema: {
    type: 'object',
    properties: { pid: { type: 'number' }, signal: { type: 'string' } },
    required: ['pid'],
  },
  execute: async (args) => kill({ pid: Number((args as { pid: unknown }).pid), signal: (args as { signal?: string }).signal }),
};

export const processTools: Tool[] = [processListTool, processInspectTool, processKillTool];

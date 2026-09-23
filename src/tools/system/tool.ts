import { z } from 'zod';
import os from 'node:os';
import type { Tool } from '../../agent/types.js';
import type {
  SystemHostnameInput,
  SystemInfoInput,
  SystemOsInput,
  SystemResourcesInput,
  SystemUptimeInput,
} from './types.js';

function info(_input: SystemInfoInput) {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const load = os.loadavg();
  const result: Record<string, unknown> = {
    hostname: os.hostname(),
    platform: os.platform(),
    architecture: os.arch(),
    release: os.release(),
    version: os.version(),
    cpuCount: os.cpus().length,
    memoryTotal: total,
    memoryFree: free,
    memoryUsed: used,
    uptime: os.uptime(),
  };
  if (load[0] !== 0 || load[1] !== 0 || load[2] !== 0) {
    result.loadAverage1m = load[0];
    result.loadAverage5m = load[1];
    result.loadAverage15m = load[2];
  }
  return JSON.stringify(result);
}

function resources(_input: SystemResourcesInput) {
  const total = os.totalmem();
  const free = os.freemem();
  return JSON.stringify({
    memoryTotal: total,
    memoryFree: free,
    memoryUsed: total - free,
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg(),
    uptime: os.uptime(),
  });
}

function uptime(_input: SystemUptimeInput) {
  return JSON.stringify({ uptime: os.uptime() });
}

function hostname(_input: SystemHostnameInput) {
  return JSON.stringify({ hostname: os.hostname() });
}

function osInfo(_input: SystemOsInput) {
  return JSON.stringify({
    platform: os.platform(),
    architecture: os.arch(),
    release: os.release(),
    version: os.version(),
  });
}

const emptySchema = z.object({});
const emptyParameterSchema = { type: 'object', properties: {} } as const;

export const systemInfoTool: Tool = {
  name: 'system_info',
  description:
    'Return a broad summary of the VPS: hostname, operating system, architecture, kernel release, CPU count, memory totals, uptime, and load average when available. Use this for quick health checks or environment discovery.',
  parameters: emptySchema,
  parameterSchema: emptyParameterSchema,
  execute: async () => info({}),
};

export const systemResourcesTool: Tool = {
  name: 'system_resources',
  description:
    'Return current resource usage: total, free, and used memory, CPU count, load average, and uptime. Use this to answer questions such as "cek RAM VPS".',
  parameters: emptySchema,
  parameterSchema: emptyParameterSchema,
  execute: async () => resources({}),
};

export const systemUptimeTool: Tool = {
  name: 'system_uptime',
  description: 'Return the system uptime in seconds.',
  parameters: emptySchema,
  parameterSchema: emptyParameterSchema,
  execute: async () => uptime({}),
};

export const systemHostnameTool: Tool = {
  name: 'system_hostname',
  description: 'Return the system hostname.',
  parameters: emptySchema,
  parameterSchema: emptyParameterSchema,
  execute: async () => hostname({}),
};

export const systemOsTool: Tool = {
  name: 'system_os',
  description: 'Return the operating system platform, architecture, release, and version.',
  parameters: emptySchema,
  parameterSchema: emptyParameterSchema,
  execute: async () => osInfo({}),
};

export const systemTools: Tool[] = [
  systemInfoTool,
  systemResourcesTool,
  systemUptimeTool,
  systemHostnameTool,
  systemOsTool,
];

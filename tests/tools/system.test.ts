import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { systemTools } from '../../src/tools/system/tool.js';
import { loadConfig } from '../../src/config.js';
import type { ToolContext } from '../../src/tools/context.js';

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

function findTool(name: string) {
  const tool = systemTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('system tools', () => {
  const ctx = createContext();

  it('system_info returns basic VPS metadata', async () => {
    const tool = findTool('system_info');
    const output = JSON.parse(await tool.execute({}, ctx));
    expect(typeof output.hostname).toBe('string');
    expect(typeof output.platform).toBe('string');
    expect(typeof output.architecture).toBe('string');
    expect(typeof output.cpuCount).toBe('number');
    expect(typeof output.memoryTotal).toBe('number');
    expect(typeof output.memoryUsed).toBe('number');
    expect(typeof output.uptime).toBe('number');
  });

  it('system_resources returns memory and uptime', async () => {
    const tool = findTool('system_resources');
    const output = JSON.parse(await tool.execute({}, ctx));
    expect(typeof output.memoryTotal).toBe('number');
    expect(typeof output.memoryFree).toBe('number');
    expect(typeof output.memoryUsed).toBe('number');
    expect(Array.isArray(output.loadAverage)).toBe(true);
  });

  it('system_uptime returns uptime seconds', async () => {
    const tool = findTool('system_uptime');
    const output = JSON.parse(await tool.execute({}, ctx));
    expect(typeof output.uptime).toBe('number');
    expect(output.uptime).toBeGreaterThanOrEqual(0);
  });

  it('system_hostname returns the hostname', async () => {
    const tool = findTool('system_hostname');
    const output = JSON.parse(await tool.execute({}, ctx));
    expect(typeof output.hostname).toBe('string');
    expect(output.hostname.length).toBeGreaterThan(0);
  });

  it('system_os returns platform and architecture', async () => {
    const tool = findTool('system_os');
    const output = JSON.parse(await tool.execute({}, ctx));
    expect(typeof output.platform).toBe('string');
    expect(typeof output.architecture).toBe('string');
  });
});

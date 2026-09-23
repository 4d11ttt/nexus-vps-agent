import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { processTools } from '../../src/tools/process/tool.js';
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
  const tool = processTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('process tools', () => {
  const ctx = createContext();

  it('lists processes on Linux or returns an unsupported note on Windows', async () => {
    const tool = findTool('process_list');
    const output = JSON.parse(await tool.execute({}, ctx));
    if (process.platform === 'win32') {
      expect(output.note).toContain('not supported on Windows');
      expect(output.processes).toEqual([]);
    } else {
      expect(typeof output.count).toBe('number');
      expect(Array.isArray(output.processes)).toBe(true);
    }
  });

  it('inspects a process on Linux or returns unsupported on Windows', async () => {
    const tool = findTool('process_inspect');
    const output = JSON.parse(await tool.execute({ pid: process.pid }, ctx));
    if (process.platform === 'win32') {
      expect(output.error).toContain('not supported on Windows');
    } else {
      expect(output.pid).toBe(process.pid);
      expect(typeof output.command).toBe('string');
    }
  });

  it('describes process fields in the schema', () => {
    const listTool = findTool('process_list');
    expect(listTool.description.toLowerCase()).toContain('pid');
    expect(listTool.name).toBe('process_list');
  });
});

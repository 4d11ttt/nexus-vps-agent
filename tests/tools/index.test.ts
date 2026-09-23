import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/agent/ToolRegistry.js';
import { registerCoreTools } from '../../src/tools/index.js';

const EXPECTED_TOOLS = [
  'shell',
  'filesystem_read',
  'filesystem_write',
  'filesystem_edit',
  'filesystem_list',
  'filesystem_stat',
  'filesystem_search',
  'filesystem_delete',
  'filesystem_mkdir',
  'process_list',
  'process_inspect',
  'process_kill',
  'system_info',
  'system_resources',
  'system_uptime',
  'system_hostname',
  'system_os',
  'package_manager',
];

describe('registerCoreTools', () => {
  it('registers all expected tools', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);
    for (const name of EXPECTED_TOOLS) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it('produces tool definitions for the LLM', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);
    const definitions = registry.toToolDefinitions();
    expect(definitions).toHaveLength(EXPECTED_TOOLS.length);
    const names = definitions.map((d) => d.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });
});

import { ToolRegistry } from '../agent/ToolRegistry.js';
import { filesystemTools } from './filesystem/tool.js';
import { packageManagerTool } from './package-manager/tool.js';
import { processTools } from './process/tool.js';
import { shellTool } from './shell/tool.js';
import { systemTools } from './system/tool.js';

/**
 * Register all core VPS tools on the provided ToolRegistry.
 *
 * This is the central place that wires up the real tool implementations
 * (shell, filesystem, process, system, package manager) without hardcoding
 * them into AgentCore.
 */
export function registerCoreTools(registry: ToolRegistry): void {
  registry.register(shellTool);
  for (const tool of filesystemTools) {
    registry.register(tool);
  }
  for (const tool of processTools) {
    registry.register(tool);
  }
  for (const tool of systemTools) {
    registry.register(tool);
  }
  registry.register(packageManagerTool);
}

export * from './context.js';
export * from './filesystem/tool.js';
export * from './filesystem/types.js';
export * from './package-manager/tool.js';
export * from './package-manager/types.js';
export * from './process/tool.js';
export * from './process/types.js';
export * from './shell/tool.js';
export * from './shell/types.js';
export * from './system/tool.js';
export * from './system/types.js';

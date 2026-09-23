import { z } from 'zod';
import type { Tool } from '../../agent/types.js';
import { runShell } from './executor.js';

const shellInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  env: z.record(z.string()).optional(),
  stdin: z.string().optional(),
});

export const shellTool: Tool = {
  name: 'shell',
  description:
    'Execute a shell command on the host VPS. Use this for system operations such as checking services, running diagnostics, installing packages via apt, or inspecting files. The command runs in a fresh process. Supports optional cwd, timeout, environment variables, and stdin.',
  parameters: shellInputSchema,
  parameterSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
      env: { type: 'object', description: 'Extra environment variables' },
      stdin: { type: 'string', description: 'Stdin to pipe to the command' },
    },
    required: ['command'],
  },
  execute: async (args, ctx) => {
    const input = shellInputSchema.parse(args);
    const result = await runShell(input, ctx);
    return JSON.stringify(result);
  },
};

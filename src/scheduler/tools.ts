import { z } from 'zod';
import type { Tool } from '../agent/types.js';
import { Scheduler } from './Scheduler.js';
import { jobScheduleSchema } from './types.js';

/**
 * Scheduler tools exposed to the agent through the ToolRegistry.
 *
 * All operations are scoped to the authenticated user via ToolContext.userId,
 * so users can only create, list, and cancel their own jobs.
 */
export function createSchedulerTools(scheduler: Scheduler): Tool[] {
  const createTool: Tool = {
    name: 'schedule_create',
    description:
      'Create a scheduled task. Supports one-time jobs (run at an ISO timestamp) and interval jobs (run every N milliseconds). The instruction is a natural-language task executed through the agent. Set notify=true to receive the result over Telegram.',
    parameters: z.object({
      name: z.string().min(1),
      instruction: z.string().min(1),
      schedule: jobScheduleSchema,
      notify: z.boolean().optional(),
    }),
    parameterSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name for the job' },
        instruction: { type: 'string', description: 'Natural-language task to run' },
        schedule: {
          type: 'object',
          description: 'Either {"type":"once","at":"ISO timestamp"} or {"type":"interval","intervalMs":number}',
        },
        notify: { type: 'boolean', description: 'Send the result to Telegram' },
      },
      required: ['name', 'instruction', 'schedule'],
    },
    execute: async (args, ctx) => {
      const input = z
        .object({
          name: z.string().min(1),
          instruction: z.string().min(1),
          schedule: jobScheduleSchema,
          notify: z.boolean().optional(),
        })
        .parse(args);
      const job = scheduler.createJob(ctx.userId, input);
      return JSON.stringify({
        success: true,
        id: job.id,
        name: job.name,
        nextRunAt: job.next_run_at,
      });
    },
  };

  const listTool: Tool = {
    name: 'schedule_list',
    description: 'List scheduled jobs for the current user, including status and next run time.',
    parameters: z.object({}),
    parameterSchema: { type: 'object', properties: {} },
    execute: async (_args, ctx) => {
      const jobs = scheduler.listJobs(ctx.userId);
      return JSON.stringify({
        count: jobs.length,
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          status: j.status,
          enabled: j.enabled,
          runCount: j.run_count,
          nextRunAt: j.next_run_at,
          lastRunAt: j.last_run_at,
        })),
      });
    },
  };

  const cancelTool: Tool = {
    name: 'schedule_cancel',
    description: 'Cancel a scheduled job owned by the current user by its numeric id.',
    parameters: z.object({ id: z.number().int().positive() }),
    parameterSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Job id' } },
      required: ['id'],
    },
    execute: async (args, ctx) => {
      const { id } = z.object({ id: z.number().int().positive() }).parse(args);
      const cancelled = scheduler.cancelJob(ctx.userId, id);
      return JSON.stringify({ success: cancelled, id });
    },
  };

  return [createTool, listTool, cancelTool];
}

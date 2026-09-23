import { z } from 'zod';

export const jobScheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('once'), at: z.string().min(1) }),
  z.object({ type: z.literal('interval'), intervalMs: z.number().int().positive() }),
]);
export type JobSchedule = z.infer<typeof jobScheduleSchema>;

export const jobPayloadSchema = z.object({
  instruction: z.string().min(1),
  notify: z.boolean().optional(),
});
export type JobPayload = z.infer<typeof jobPayloadSchema>;

/**
 * Minimal interface the scheduler needs to execute a scheduled task through
 * AgentCore (which satisfies this shape).
 */
export interface ScheduledTaskRunner {
  run(input: {
    userId: number;
    message: string;
  }): Promise<{ response: string; finishReason: string }>;
}

/**
 * Delivery hook for scheduled-job results. The Telegram adapter implements
 * this; the scheduler never talks to grammY directly.
 */
export interface SchedulerNotifier {
  notify(telegramUserId: number, text: string): Promise<void>;
}

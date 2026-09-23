import { z } from 'zod';
import type { Tool } from '../agent/types.js';
import { MemoryManager } from './MemoryManager.js';

/**
 * Persistent memory tools exposed to the agent through the ToolRegistry.
 *
 * All operations are scoped to the authenticated user via ToolContext.userId.
 */
export function createMemoryTools(memory: MemoryManager): Tool[] {
  const searchTool: Tool = {
    name: 'memory_search',
    description:
      'Search the agent persistent memory for facts related to the given query. Returns the most relevant remembered facts for the current user.',
    parameters: z.object({ query: z.string().min(1) }),
    parameterSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms or topic to look up' },
      },
      required: ['query'],
    },
    execute: async (args, ctx) => {
      const { query } = z.object({ query: z.string().min(1) }).parse(args);
      const results = memory.search(ctx.userId, query);
      return JSON.stringify({
        count: results.length,
        results: results.map((m) => ({
          key: m.key,
          content: m.content,
          category: m.category,
          importance: m.importance,
        })),
      });
    },
  };

  const saveTool: Tool = {
    name: 'memory_save',
    description:
      'Save a durable fact to persistent memory for the current user. Use for information likely to remain useful across future tasks. Do not store secrets.',
    parameters: z.object({
      key: z.string().min(1),
      content: z.string().min(1),
      category: z.string().optional(),
      importance: z.number().int().min(0).max(10).optional(),
    }),
    parameterSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short unique key for the fact' },
        content: { type: 'string', description: 'The fact to remember' },
        category: { type: 'string', description: 'Optional category' },
        importance: { type: 'number', description: 'Importance 0-10' },
      },
      required: ['key', 'content'],
    },
    execute: async (args, ctx) => {
      const input = z
        .object({
          key: z.string().min(1),
          content: z.string().min(1),
          category: z.string().optional(),
          importance: z.number().int().min(0).max(10).optional(),
        })
        .parse(args);
      const saved = memory.save(ctx.userId, input);
      return JSON.stringify({ success: true, id: saved.id, key: saved.key });
    },
  };

  const updateTool: Tool = {
    name: 'memory_update',
    description:
      'Update the content of an existing durable memory fact identified by key. Returns an error if the key does not exist.',
    parameters: z.object({ key: z.string().min(1), content: z.string().min(1) }),
    parameterSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key of the fact to update' },
        content: { type: 'string', description: 'New content' },
      },
      required: ['key', 'content'],
    },
    execute: async (args, ctx) => {
      const { key, content } = z
        .object({ key: z.string().min(1), content: z.string().min(1) })
        .parse(args);
      const updated = memory.updateByKey(ctx.userId, key, content);
      if (!updated) {
        return JSON.stringify({ success: false, error: `No memory found for key: ${key}` });
      }
      return JSON.stringify({ success: true, id: updated.id, key: updated.key });
    },
  };

  const deleteTool: Tool = {
    name: 'memory_delete',
    description: 'Delete a durable memory fact identified by key. Returns an error if the key does not exist.',
    parameters: z.object({ key: z.string().min(1) }),
    parameterSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Key of the fact to delete' } },
      required: ['key'],
    },
    execute: async (args, ctx) => {
      const { key } = z.object({ key: z.string().min(1) }).parse(args);
      const deleted = memory.deleteByKey(ctx.userId, key);
      return JSON.stringify({ success: deleted, key });
    },
  };

  return [searchTool, saveTool, updateTool, deleteTool];
}

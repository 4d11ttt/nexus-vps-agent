import { z } from 'zod';
import type { Tool } from '../agent/types.js';
import { SkillManager } from './SkillManager.js';

/**
 * Skill tools exposed to the agent through the ToolRegistry.
 *
 * `skill_list` shows the available skills and `skill_read` loads the full
 * SKILL.md content of one skill on demand, keeping the default context small.
 */
export function createSkillTools(skillManager: SkillManager): Tool[] {
  const listTool: Tool = {
    name: 'skill_list',
    description:
      'List available reusable skills. Each skill is a documented workflow/knowledge file. Use skill_read to load a specific skill into context when relevant.',
    parameters: z.object({}),
    parameterSchema: { type: 'object', properties: {} },
    execute: async () => {
      const skills = skillManager.list();
      return JSON.stringify({
        count: skills.length,
        skills: skills.map((s) => ({ name: s.name, description: s.description })),
      });
    },
  };

  const readTool: Tool = {
    name: 'skill_read',
    description:
      'Read the full instructions/workflow of a specific skill by name. Returns the SKILL.md content as text.',
    parameters: z.object({ name: z.string().min(1) }),
    parameterSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name' } },
      required: ['name'],
    },
    execute: async (args) => {
      const { name } = z.object({ name: z.string().min(1) }).parse(args);
      const content = skillManager.read(name);
      if (content === undefined) {
        return JSON.stringify({ success: false, error: `Skill not found: ${name}` });
      }
      return JSON.stringify({ success: true, name, content });
    },
  };

  return [listTool, readTool];
}

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../database/Database.js';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface SkillManagerDeps {
  db: Database;
  config: Config;
  logger: Logger;
}

const SKILL_FILE = 'SKILL.md';

/**
 * Discovers and loads reusable skills from `workspace/skills/<name>/SKILL.md`.
 *
 * A skill is instructions/workflow knowledge, never executable code. Skills are
 * indexed into the existing `skills` table and their full contents can be read
 * on demand by the agent.
 */
export class SkillManager {
  private readonly skills = new Map<string, SkillInfo>();

  constructor(private readonly deps: SkillManagerDeps) {}

  getSkillsDir(): string {
    return resolve(this.deps.config.WORKSPACE_DIR, 'skills');
  }

  /**
   * Scan the skills directory and synchronize the in-memory index and the
   * database. Safe to call multiple times (e.g. on startup and on demand).
   */
  discover(): SkillInfo[] {
    const dir = this.getSkillsDir();
    this.skills.clear();

    if (!existsSync(dir)) {
      this.deps.logger.warn({ dir }, 'Skills directory not found');
      return [];
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      this.deps.logger.warn({ dir, error }, 'Failed to read skills directory');
      return [];
    }

    for (const entry of entries) {
      const skillDir = join(dir, entry);
      const skillFile = join(skillDir, SKILL_FILE);
      try {
        if (!statSync(skillDir).isDirectory()) continue;
        if (!existsSync(skillFile)) continue;

        const content = readFileSync(skillFile, 'utf-8');
        const info: SkillInfo = {
          name: entry,
          description: parseDescription(content),
          path: skillDir,
        };
        this.skills.set(info.name, info);
        this.syncToDatabase(info);
      } catch (error) {
        this.deps.logger.warn({ skill: entry, error }, 'Failed to load skill');
      }
    }

    return this.list();
  }

  list(): SkillInfo[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  read(name: string): string | undefined {
    const info = this.skills.get(name);
    if (!info) return undefined;
    try {
      return readFileSync(join(info.path, SKILL_FILE), 'utf-8');
    } catch {
      return undefined;
    }
  }

  /**
   * Compact index block listing skill names and descriptions for the system
   * prompt. Full skill contents are loaded only via `skill_read`.
   */
  buildSkillIndex(): string {
    const skills = this.list();
    if (skills.length === 0) return '';
    const lines = skills.map((s) => `- ${s.name}: ${s.description}`.trim());
    return `Available skills (read one with skill_read when relevant):\n${lines.join('\n')}`;
  }

  private syncToDatabase(info: SkillInfo): void {
    const existing = this.deps.db.repositories.skills.findByName(info.name);
    if (existing) {
      this.deps.db.repositories.skills.update(existing.id, {
        path: info.path,
        description: info.description,
      });
    } else {
      this.deps.db.repositories.skills.create({
        name: info.name,
        path: info.path,
        description: info.description,
        enabled: 1,
      });
    }
  }
}

/**
 * Extract a short description from a SKILL.md body. Supports an optional
 * front-matter block with `description: ...` and falls back to the first
 * non-empty, non-heading line.
 */
function parseDescription(content: string): string {
  const trimmed = content.trimStart();

  const frontMatter = trimmed.match(/(?:^|\n)---\s*\n([\s\S]*?)\n---\s*/);
  if (frontMatter) {
    const desc = frontMatter[1]
      .split('\n')
      .map((line) => line.match(/^description:\s*(.+)$/i))
      .find((m) => m !== null);
    if (desc) return desc[1].trim();
  }

  const body = frontMatter ? trimmed.slice(frontMatter[0].length) : trimmed;
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  return firstLine ?? 'No description provided';
}

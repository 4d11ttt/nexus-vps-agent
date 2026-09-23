import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../database/Database.js';
import type { Memory } from '../database/types.js';

export interface MemoryManagerDeps {
  db: Database;
  config: Config;
  logger: Logger;
}

export interface MemorySaveInput {
  key: string;
  content: string;
  category?: string;
  importance?: number;
}

/**
 * Loads the workspace identity/preference/knowledge files and provides the
 * persistent memory operations used by the memory tools.
 *
 * SOUL.md / USER.md / MEMORY.md are workspace files (not the SQLite memory
 * table). Durable, searchable facts are stored per user in the `memories`
 * table via `save` / `update` / `delete`.
 */
export class MemoryManager {
  constructor(private readonly deps: MemoryManagerDeps) {}

  getWorkspaceDir(): string {
    return resolve(this.deps.config.WORKSPACE_DIR);
  }

  /** Read a workspace markdown file, returning '' when it does not exist. */
  readWorkspaceFile(name: string): string {
    const path = resolve(this.getWorkspaceDir(), name);
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      this.deps.logger.warn({ path }, `Workspace file not found: ${name}`);
      return '';
    }
  }

  loadSoul(): string {
    return this.readWorkspaceFile('SOUL.md');
  }

  loadUser(): string {
    return this.readWorkspaceFile('USER.md');
  }

  loadMemoryFile(): string {
    return this.readWorkspaceFile('MEMORY.md');
  }

  /**
   * Simple case-insensitive substring search over key, content, and category.
   * Bounded by MEMORY_MAX_RESULTS and ordered by importance then recency.
   */
  search(userId: number, query: string): Memory[] {
    const q = query.trim().toLowerCase();
    const all = this.deps.db.repositories.memories.findByUserId(userId);
    if (!q) {
      return all
        .slice()
        .sort((a, b) => b.importance - a.importance)
        .slice(0, this.deps.config.MEMORY_MAX_RESULTS);
    }
    const matches = all
      .filter(
        (m) =>
          m.key.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q),
      )
      .sort((a, b) => b.importance - a.importance);
    return matches.slice(0, this.deps.config.MEMORY_MAX_RESULTS);
  }

  list(userId: number): Memory[] {
    return this.deps.db.repositories.memories.findByUserId(userId);
  }

  save(userId: number, input: MemorySaveInput): Memory {
    const existing = this.deps.db.repositories.memories.findByKey(userId, input.key);
    if (existing) {
      return (
        this.deps.db.repositories.memories.update(existing.id, {
          content: input.content,
          category: input.category,
          importance: input.importance,
        }) ?? existing
      );
    }
    return this.deps.db.repositories.memories.create({
      user_id: userId,
      key: input.key,
      content: input.content,
      category: input.category ?? 'general',
      importance: input.importance ?? 0,
    });
  }

  updateByKey(userId: number, key: string, content: string): Memory | undefined {
    const existing = this.deps.db.repositories.memories.findByKey(userId, key);
    if (!existing) return undefined;
    return this.deps.db.repositories.memories.update(existing.id, { content });
  }

  deleteByKey(userId: number, key: string): boolean {
    const existing = this.deps.db.repositories.memories.findByKey(userId, key);
    if (!existing) return false;
    return this.deps.db.repositories.memories.delete(existing.id);
  }

  /**
   * Build a compact, bounded memory context block for injection into the system
   * prompt. The total size is capped by MEMORY_CONTEXT_LIMIT characters; an
   * oversized single fact is truncated rather than dropped.
   */
  buildMemoryContext(userId: number, query: string): string {
    const memories = this.search(userId, query);
    if (memories.length === 0) return '';

    const limit = this.deps.config.MEMORY_CONTEXT_LIMIT;
    const header = 'Relevant remembered facts:';
    const maxBody = Math.max(limit - header.length - 1, 1);

    const lines: string[] = [];
    let used = 0;

    for (const m of memories) {
      let line = `- [${m.key}] ${m.content}`;
      const remaining = maxBody - used;
      if (remaining <= 0) break;
      if (line.length > remaining) {
        line = `${line.slice(0, Math.max(remaining - 1, 0))}…`;
      }
      lines.push(line);
      used += line.length + 1; // account for the joining newline
    }

    return lines.length > 0 ? `${header}\n${lines.join('\n')}` : '';
  }
}

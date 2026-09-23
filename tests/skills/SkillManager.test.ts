import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { SkillManager } from '../../src/skills/SkillManager.js';
import { createSkillTools } from '../../src/skills/tools.js';
import { createTestDatabase } from '../database/helpers.js';
import { loadConfig } from '../../src/config.js';
import type { Database } from '../../src/database/Database.js';
import type { ToolContext } from '../../src/tools/context.js';

function makeCtx(userId: number): ToolContext {
  return {
    logger: pino({ level: 'silent' }),
    config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    userId,
    sessionId: 1,
  };
}

describe('SkillManager', () => {
  let db: Database;
  let cleanup: () => void;
  let workspaceDir: string;
  let manager: SkillManager;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;

    workspaceDir = mkdtempSync(join(tmpdir(), 'nexus-skills-'));
    const skillsDir = join(workspaceDir, 'skills');
    mkdirSync(join(skillsDir, 'system-admin'), { recursive: true });
    mkdirSync(join(skillsDir, 'docker'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'system-admin', 'SKILL.md'),
      '# System Admin\n---\ndescription: Manage system services\n---\nWorkflow steps here.',
    );
    writeFileSync(
      join(skillsDir, 'docker', 'SKILL.md'),
      '# Docker\nManage containers safely.',
    );

    manager = new SkillManager({
      db,
      config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', WORKSPACE_DIR: workspaceDir }),
      logger: pino({ level: 'silent' }),
    });
  });

  afterEach(() => {
    cleanup();
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('discovers skills from the workspace', () => {
    const skills = manager.discover();
    expect(skills.map((s) => s.name).sort()).toEqual(['docker', 'system-admin']);
  });

  it('parses a front-matter description and falls back to first line', () => {
    manager.discover();
    expect(manager.get('system-admin')?.description).toBe('Manage system services');
    expect(manager.get('docker')?.description).toBe('Manage containers safely.');
  });

  it('reads full skill content on demand', () => {
    manager.discover();
    const content = manager.read('docker');
    expect(content).toContain('Manage containers safely.');
  });

  it('builds a compact skill index and syncs to the database', () => {
    manager.discover();
    const index = manager.buildSkillIndex();
    expect(index).toContain('docker');
    expect(index).toContain('system-admin');

    const persisted = db.repositories.skills.findByName('docker');
    expect(persisted).toBeDefined();
    expect(persisted?.description).toContain('containers');
  });

  it('returns undefined for unknown skills', () => {
    manager.discover();
    expect(manager.read('missing')).toBeUndefined();
    expect(manager.get('missing')).toBeUndefined();
  });
});

describe('skill tools', () => {
  it('skill_list and skill_read work through the registry tools', async () => {
    const testDb = createTestDatabase();
    const workspace = mkdtempSync(join(tmpdir(), 'nexus-skills2-'));
    const skillsDir = join(workspace, 'skills', 'docker');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'SKILL.md'), '# Docker\nRun containers.');

    const manager = new SkillManager({
      db: testDb.db,
      config: loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', WORKSPACE_DIR: workspace }),
      logger: pino({ level: 'silent' }),
    });
    manager.discover();
    const tools = createSkillTools(manager);

    const listTool = tools.find((t) => t.name === 'skill_list')!;
    const readTool = tools.find((t) => t.name === 'skill_read')!;

    const listResult = await listTool.execute({}, makeCtx(1));
    expect(JSON.parse(listResult).skills[0].name).toBe('docker');

    const readResult = await readTool.execute({ name: 'docker' }, makeCtx(1));
    expect(JSON.parse(readResult).content).toContain('Run containers.');

    testDb.cleanup();
    rmSync(workspace, { recursive: true, force: true });
  });
});

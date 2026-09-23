import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtemp,
  rm,
  writeFile as fsWriteFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { filesystemTools } from '../../src/tools/filesystem/tool.js';
import { loadConfig } from '../../src/config.js';
import type { ToolContext } from '../../src/tools/context.js';

function createContext(): ToolContext {
  return {
    userId: 1,
    sessionId: 1,
    logger: pino({ level: 'silent' }),
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: './data/agent.db',
    }),
  };
}

function findTool(name: string) {
  const tool = filesystemTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('filesystem tools', () => {
  let tempDir: string;
  const ctx = createContext();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nexus-fs-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads a written file', async () => {
    const writeTool = findTool('filesystem_write');
    const readTool = findTool('filesystem_read');
    const path = join(tempDir, 'hello.txt');

    const writeResult = JSON.parse(await writeTool.execute({ path, content: 'world' }, ctx));
    expect(writeResult.success).toBe(true);

    const readResult = JSON.parse(await readTool.execute({ path }, ctx));
    expect(readResult.content).toBe('world');
    expect(readResult.encoding).toBe('utf-8');
  });

  it('creates parent directories on write', async () => {
    const writeTool = findTool('filesystem_write');
    const path = join(tempDir, 'a', 'b', 'c.txt');
    const result = JSON.parse(await writeTool.execute({ path, content: 'deep' }, ctx));
    expect(result.success).toBe(true);
  });

  it('edits a file replacing exactly one occurrence', async () => {
    const editTool = findTool('filesystem_edit');
    const readTool = findTool('filesystem_read');
    const path = join(tempDir, 'edit.txt');
    await fsWriteFile(path, 'foo bar baz', 'utf-8');

    const editResult = JSON.parse(
      await editTool.execute({ path, search: 'bar', replace: 'qux' }, ctx),
    );
    expect(editResult.success).toBe(true);

    const readResult = JSON.parse(await readTool.execute({ path }, ctx));
    expect(readResult.content).toBe('foo qux baz');
  });

  it('fails to edit when search text is missing', async () => {
    const editTool = findTool('filesystem_edit');
    const path = join(tempDir, 'missing.txt');
    await fsWriteFile(path, 'hello', 'utf-8');

    await expect(
      editTool.execute({ path, search: 'xyz', replace: 'abc' }, ctx),
    ).rejects.toThrow('Search text not found');
  });

  it('fails to edit when search text is ambiguous', async () => {
    const editTool = findTool('filesystem_edit');
    const path = join(tempDir, 'ambiguous.txt');
    await fsWriteFile(path, 'abc abc', 'utf-8');

    await expect(
      editTool.execute({ path, search: 'abc', replace: 'x' }, ctx),
    ).rejects.toThrow('ambiguous');
  });
  it('lists directory entries', async () => {
    const writeTool = findTool('filesystem_write');
    const listTool = findTool('filesystem_list');
    await writeTool.execute({ path: join(tempDir, 'one.txt'), content: '1' }, ctx);
    await writeTool.execute({ path: join(tempDir, 'two.txt'), content: '2' }, ctx);

    const result = JSON.parse(await listTool.execute({ path: tempDir }, ctx));
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i: { name: string }) => i.name).sort()).toEqual([
      'one.txt',
      'two.txt',
    ]);
  });

  it('returns metadata from stat', async () => {
    const writeTool = findTool('filesystem_write');
    const statTool = findTool('filesystem_stat');
    const path = join(tempDir, 'stat.txt');
    await writeTool.execute({ path, content: 'metadata' }, ctx);

    const result = JSON.parse(await statTool.execute({ path }, ctx));
    expect(result.isFile).toBe(true);
    expect(result.isDirectory).toBe(false);
    expect(typeof result.size).toBe('number');
    expect(typeof result.mode).toBe('number');
  });

  it('creates directories recursively', async () => {
    const mkdirTool = findTool('filesystem_mkdir');
    const path = join(tempDir, 'nested', 'dir');
    const result = JSON.parse(await mkdirTool.execute({ path }, ctx));
    expect(result.success).toBe(true);
  });

  it('deletes files and directories', async () => {
    const writeTool = findTool('filesystem_write');
    const mkdirTool = findTool('filesystem_mkdir');
    const deleteTool = findTool('filesystem_delete');

    const filePath = join(tempDir, 'del.txt');
    const dirPath = join(tempDir, 'deldir');
    await writeTool.execute({ path: filePath, content: 'x' }, ctx);
    await mkdirTool.execute({ path: dirPath }, ctx);

    const fileResult = JSON.parse(await deleteTool.execute({ path: filePath }, ctx));
    expect(fileResult.success).toBe(true);

    const dirResult = JSON.parse(await deleteTool.execute({ path: dirPath, recursive: true }, ctx));
    expect(dirResult.success).toBe(true);
  });

  it('searches files by name and content', async () => {
    const writeTool = findTool('filesystem_write');
    const searchTool = findTool('filesystem_search');
    await writeTool.execute({ path: join(tempDir, 'a.txt'), content: 'alpha' }, ctx);
    await writeTool.execute({ path: join(tempDir, 'b.txt'), content: 'beta' }, ctx);

    const byName = JSON.parse(
      await searchTool.execute({ directory: tempDir, pattern: 'a.txt' }, ctx),
    );
    expect(byName.results.some((r: { path: string }) => r.path.includes('a.txt'))).toBe(true);

    const byContent = JSON.parse(
      await searchTool.execute({ directory: tempDir, content: 'beta' }, ctx),
    );
    expect(byContent.results).toHaveLength(1);
  });

  it('reports an error for a missing path', async () => {
    const readTool = findTool('filesystem_read');
    await expect(
      readTool.execute({ path: join(tempDir, 'does-not-exist.txt') }, ctx),
    ).rejects.toThrow();
  });

  it('rejects an invalid path when reading a directory as a file', async () => {
    const readTool = findTool('filesystem_read');
    await expect(readTool.execute({ path: tempDir }, ctx)).rejects.toThrow();
  });

  it('rejects an invalid path when listing a file as a directory', async () => {
    const writeTool = findTool('filesystem_write');
    const listTool = findTool('filesystem_list');
    const path = join(tempDir, 'not-a-dir.txt');
    await writeTool.execute({ path, content: 'x' }, ctx);
    await expect(listTool.execute({ path }, ctx)).rejects.toThrow();
  });

  it('refuses to write through a symbolic link', async () => {
    const writeTool = findTool('filesystem_write');
    const target = join(tempDir, 'target.txt');
    const link = join(tempDir, 'link.txt');
    await fsWriteFile(target, 'target content', 'utf-8');
    try {
      await symlink(target, link);
    } catch {
      // Symlinks may require privileges on Windows; skip the test in that case.
      return;
    }

    await expect(
      writeTool.execute({ path: link, content: 'should not overwrite target' }, ctx),
    ).rejects.toThrow('symbolic link');
  });
});


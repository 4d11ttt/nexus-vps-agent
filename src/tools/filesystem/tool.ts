import { z } from 'zod';
import {
  readFile,
  writeFile,
  mkdir as fsMkdir,
  readdir,
  lstat,
  rm,
  unlink,
  rmdir,
  readlink,
} from 'node:fs/promises';
import { dirname, resolve, basename, join } from 'node:path';
import type { Tool } from '../../agent/types.js';
import type {
  FsDeleteInput,
  FsEditInput,
  FsListInput,
  FsMkdirInput,
  FsReadInput,
  FsSearchInput,
  FsStatInput,
  FsWriteInput,
} from './types.js';

/**
 * Resolve a user-supplied path to an absolute, normalized path.
 *
 * We deliberately do *not* call realpath() here. Root access is intentional,
 * but path handling must remain deterministic and symlink-aware. Each tool
 * decides whether to follow a symlink based on its semantics.
 */
function safeResolve(rawPath: string): string {
  return resolve(rawPath);
}

async function read(input: FsReadInput) {
  const path = safeResolve(input.path);
  const info = await lstat(path);
  const content = await readFile(path, 'utf-8');
  return JSON.stringify({
    content,
    size: Buffer.byteLength(content),
    encoding: 'utf-8',
    isSymbolicLink: info.isSymbolicLink(),
  });
}

async function write(input: FsWriteInput) {
  const path = safeResolve(input.path);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  await fsMkdir(dirname(path), { recursive: true });
  await writeFile(path, input.content, { encoding: (input.encoding ?? 'utf-8') as BufferEncoding });
  return JSON.stringify({ success: true, path });
}

async function edit(input: FsEditInput) {
  const path = safeResolve(input.path);
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error(`Refusing to edit through symbolic link: ${path}`);
  }
  const content = await readFile(path, 'utf-8');
  const count = content.split(input.search).length - 1;
  if (count === 0) {
    throw new Error(`Search text not found in ${input.path}`);
  }
  if (count > 1) {
    throw new Error(`Search text is ambiguous (${count} occurrences) in ${input.path}`);
  }
  const updated = content.replace(input.search, input.replace);
  await writeFile(path, updated, { encoding: 'utf-8' as BufferEncoding });
  return JSON.stringify({ success: true, path });
}
async function list(input: FsListInput) {
  const path = safeResolve(input.path);
  const entries = await readdir(path, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      let size = 0;
      let modifiedAt: string | undefined;
      let type: string;
      try {
        const info = await lstat(entryPath);
        size = info.size;
        modifiedAt = info.mtime.toISOString();
        if (info.isSymbolicLink()) type = 'symlink';
        else if (info.isDirectory()) type = 'directory';
        else if (info.isFile()) type = 'file';
        else type = 'other';
      } catch {
        type = 'other';
      }
      return {
        name: entry.name,
        type,
        size,
        modifiedAt,
      };
    }),
  );
  return JSON.stringify({ path, items });
}

async function statFile(input: FsStatInput) {
  const path = safeResolve(input.path);
  const info = await lstat(path);
  let target: string | undefined;
  if (info.isSymbolicLink()) {
    try {
      target = await readlink(path);
    } catch {
      // target unavailable
    }
  }
  return JSON.stringify({
    path,
    size: info.size,
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
    isSymbolicLink: info.isSymbolicLink(),
    symlinkTarget: target,
    mode: info.mode,
    createdAt: info.birthtime.toISOString(),
    modifiedAt: info.mtime.toISOString(),
    accessedAt: info.atime.toISOString(),
  });
}

async function search(input: FsSearchInput) {
  const directory = safeResolve(input.directory);
  const maxDepth = input.maxDepth ?? 3;
  const maxResults = input.maxResults ?? 100;
  const results: Array<{ path: string; type: string; match?: string }> = [];

  async function walk(current: string, depth: number) {
    if (depth > maxDepth || results.length >= maxResults) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      const entryPath = join(current, entry.name);
      const nameMatch = input.pattern ? basename(entry.name).includes(input.pattern) : false;
      let contentMatch: string | undefined;

      if (entry.isFile() && input.content) {
        try {
          const text = await readFile(entryPath, 'utf-8');
          if (text.includes(input.content)) contentMatch = 'content';
        } catch {
          // ignore unreadable files
        }
      }

      let type: string;
      if (entry.isSymbolicLink()) type = 'symlink';
      else if (entry.isDirectory()) type = 'directory';
      else if (entry.isFile()) type = 'file';
      else type = 'other';

      if (nameMatch || contentMatch) {
        results.push({
          path: entryPath,
          type,
          match: contentMatch ?? (nameMatch ? 'name' : undefined),
        });
      }

      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1);
      }
    }
  }

  await walk(directory, 0);
  return JSON.stringify({ directory, results });
}

async function del(input: FsDeleteInput) {
  const path = safeResolve(input.path);
  if (input.recursive) {
    await rm(path, { recursive: true, force: true });
  } else {
    const info = await lstat(path);
    if (info.isSymbolicLink() || info.isFile()) {
      await unlink(path);
    } else if (info.isDirectory()) {
      await rmdir(path);
    } else {
      throw new Error(`Unsupported file type at ${input.path}`);
    }
  }
  return JSON.stringify({ success: true, path });
}

async function mkdir(input: FsMkdirInput) {
  const path = safeResolve(input.path);
  await fsMkdir(path, { recursive: true });
  return JSON.stringify({ success: true, path });
}

function createTool<T>(
  name: string,
  description: string,
  schema: z.ZodSchema<T>,
  parameterSchema: Record<string, unknown>,
  fn: (input: T) => Promise<string>,
): Tool {
  return {
    name,
    description,
    parameters: schema,
    parameterSchema,
    execute: async (args) => fn(schema.parse(args)),
  };
}

const readTool = createTool<FsReadInput>(
  'filesystem_read',
  'Read the contents of a file as UTF-8 text. Use this for inspecting configuration, logs, source code, or any text file on the VPS. Returns content, byte size, encoding, and whether the path is a symbolic link.',
  z.object({ path: z.string().min(1) }),
  { type: 'object', properties: { path: { type: 'string', description: 'Absolute or relative file path' } }, required: ['path'] },
  read,
);

const writeTool = createTool<FsWriteInput>(
  'filesystem_write',
  'Write content to a file. Creates parent directories automatically. Overwrites existing files, but refuses to write through symbolic links for safety.',
  z.object({ path: z.string().min(1), content: z.string(), encoding: z.string().optional() }),
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
      content: { type: 'string', description: 'Text content to write' },
      encoding: { type: 'string', description: 'Encoding such as utf-8 or base64' },
    },
    required: ['path', 'content'],
  },
  write,
);

const editTool = createTool<FsEditInput>(
  'filesystem_edit',
  'Replace exactly one occurrence of a search string in a file. Fails if the search text is missing or appears more than once, so replacements are never ambiguous. Refuses to edit through symbolic links.',
  z.object({ path: z.string().min(1), search: z.string(), replace: z.string() }),
  {
    type: 'object',
    properties: {
      path: { type: 'string' },
      search: { type: 'string', description: 'Exact text to find (one occurrence only)' },
      replace: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'search', 'replace'],
  },
  edit,
);

const listTool = createTool<FsListInput>(
  'filesystem_list',
  'List files, directories, and symbolic links inside a directory. Returns name, type, size, and last modification time for each entry.',
  z.object({ path: z.string().min(1) }),
  { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] },
  list,
);

const statTool = createTool<FsStatInput>(
  'filesystem_stat',
  'Return filesystem metadata for a path, including size, type, permissions mode, timestamps, and symlink target if applicable.',
  z.object({ path: z.string().min(1) }),
  { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  statFile,
);

const searchTool = createTool<FsSearchInput>(
  'filesystem_search',
  'Search files by name substring and/or file content within a directory tree. The search is bounded by maxDepth (default 3) and maxResults (default 100) to avoid unbounded filesystem scans.',
  z.object({
    directory: z.string().min(1),
    pattern: z.string().optional(),
    content: z.string().optional(),
    maxDepth: z.number().int().positive().optional(),
    maxResults: z.number().int().positive().optional(),
  }),
  {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Directory to search' },
      pattern: { type: 'string', description: 'Name substring to match' },
      content: { type: 'string', description: 'Content substring to match inside files' },
      maxDepth: { type: 'number', description: 'Maximum recursion depth' },
      maxResults: { type: 'number', description: 'Maximum number of results' },
    },
    required: ['directory'],
  },
  search,
);

const deleteTool = createTool<FsDeleteInput>(
  'filesystem_delete',
  'Delete a file, symlink, or empty directory. Use recursive:true to delete a directory and everything inside it. Be careful with destructive operations.',
  z.object({ path: z.string().min(1), recursive: z.boolean().optional() }),
  {
    type: 'object',
    properties: {
      path: { type: 'string' },
      recursive: { type: 'boolean', description: 'Required to delete non-empty directories' },
    },
    required: ['path'],
  },
  del,
);

const mkdirTool = createTool<FsMkdirInput>(
  'filesystem_mkdir',
  'Create a directory, including all missing parent directories.',
  z.object({ path: z.string().min(1) }),
  { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  mkdir,
);

export const filesystemTools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  listTool,
  statTool,
  searchTool,
  deleteTool,
  mkdirTool,
];


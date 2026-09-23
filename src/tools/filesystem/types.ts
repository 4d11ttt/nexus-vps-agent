export interface FsReadInput {
  path: string;
}

export interface FsWriteInput {
  path: string;
  content: string;
  encoding?: string;
}

export interface FsEditInput {
  path: string;
  search: string;
  replace: string;
}

export interface FsListInput {
  path: string;
}

export interface FsStatInput {
  path: string;
}

export interface FsSearchInput {
  directory: string;
  pattern?: string;
  content?: string;
  maxDepth?: number;
  maxResults?: number;
}

export interface FsDeleteInput {
  path: string;
  recursive?: boolean;
}

export interface FsMkdirInput {
  path: string;
}

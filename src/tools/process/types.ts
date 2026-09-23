export interface ProcessListInput {}

export interface ProcessInspectInput {
  pid: number;
}

export interface ProcessKillInput {
  pid: number;
  signal?: string;
}

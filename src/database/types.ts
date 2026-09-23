import LibsqlDatabase from 'libsql';

export type DbConnection = InstanceType<typeof LibsqlDatabase>;

export interface User {
  id: number;
  telegram_user_id: string;
  username: string | null;
  display_name: string | null;
  language: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export type UserCreate = {
  telegram_user_id: string;
  username?: string | null;
  display_name?: string | null;
  language?: string;
  status?: string;
};

export type UserUpdate = Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>;

export interface Session {
  id: number;
  user_id: number;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export type SessionCreate = {
  user_id: number;
  title?: string | null;
  status?: string;
};

export type SessionUpdate = Partial<Omit<Session, 'id' | 'created_at' | 'updated_at'>>;

export interface Message {
  id: number;
  session_id: number;
  role: string;
  content: string;
  created_at: string;
}

export type MessageCreate = Omit<Message, 'id' | 'created_at'>;

export interface ToolCall {
  id: number;
  session_id: number;
  tool_name: string;
  arguments: string;
  result: string | null;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

export type ToolCallCreate = {
  session_id: number;
  tool_name: string;
  arguments: string;
  result?: string | null;
  status?: string;
  duration_ms?: number | null;
};

export interface Memory {
  id: number;
  user_id: number;
  key: string;
  content: string;
  category: string;
  importance: number;
  created_at: string;
  updated_at: string;
}

export type MemoryCreate = {
  user_id: number;
  key: string;
  content: string;
  category?: string;
  importance?: number;
};

export type MemoryUpdate = Partial<Omit<Memory, 'id' | 'created_at' | 'updated_at'>>;

export interface Skill {
  id: number;
  name: string;
  path: string;
  description: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export type SkillCreate = {
  name: string;
  path: string;
  description?: string | null;
  enabled?: number;
};

export type SkillUpdate = Partial<Omit<Skill, 'id' | 'created_at' | 'updated_at'>>;

export interface Job {
  id: number;
  user_id: number;
  name: string;
  schedule: string | null;
  payload: string;
  status: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export type JobCreate = {
  user_id: number;
  name: string;
  schedule?: string | null;
  payload?: string;
  status?: string;
  enabled?: number;
  next_run_at?: string | null;
};

export type JobUpdate = Partial<Omit<Job, 'id' | 'created_at' | 'updated_at'>>;

export interface AuditEvent {
  id: number;
  user_id: number | null;
  event_type: string;
  metadata: string;
  created_at: string;
}

export type AuditEventCreate = {
  user_id?: number | null;
  event_type: string;
  metadata?: string;
};


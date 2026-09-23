/**
 * Internal types for the LLM abstraction.
 *
 * These types are intentionally vendor-agnostic. The OpenAI-compatible provider
 * maps them to/from the wire format.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'other';

export interface ChatRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  stream?: boolean;
  abortSignal?: AbortSignal;
}

export interface ChatResponse {
  message: Message;
  toolCalls: ToolCall[];
  usage: Usage | undefined;
  finishReason: FinishReason | undefined;
}

export interface ChatStreamChunk {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: FinishReason;
  usage?: Usage;
}

export interface ModelCapability {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
}

export interface LLMProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  getCapabilities(): ModelCapability;
}

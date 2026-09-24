import { z } from 'zod';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import { LLMRuntimeConfig } from './LLMRuntimeConfig.js';
import {
  LLMError,
  LLMInvalidRequestError,
  LLMServerError,
  LLMAuthenticationError,
  LLMRateLimitError,
  LLMTimeoutError,
} from './errors.js';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  FinishReason,
  LLMProvider,
  Message,
  ModelCapability,
  ToolCall,
  Usage,
} from './types.js';
import { getModelOverride } from './ModelContext.js';

const openAIToolCallSchema = z.object({
  id: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const openAIMessageSchema = z.object({
  role: z.string().optional(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(openAIToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

const openAIDeltaSchema = z.object({
  role: z.string().optional(),
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        index: z.number(),
        id: z.string().optional(),
        function: z
          .object({
            name: z.string().optional(),
            arguments: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const openAIChoiceSchema = z.object({
  message: openAIMessageSchema.optional(),
  finish_reason: z.string().nullable().optional(),
  delta: openAIDeltaSchema.optional(),
});

const openAIUsageSchema = z.object({
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
});

const openAIChatCompletionResponseSchema = z.object({
  choices: z.array(openAIChoiceSchema).optional(),
  usage: openAIUsageSchema.optional(),
});

type OpenAIResponse = z.infer<typeof openAIChatCompletionResponseSchema>;

function normalizeFinishReason(reason: string | null | undefined): FinishReason {
  if (!reason) return 'other';
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    default:
      return 'other';
  }
}

function normalizeUsage(raw: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): Usage | undefined {
  if (
    raw.prompt_tokens === undefined &&
    raw.completion_tokens === undefined &&
    raw.total_tokens === undefined
  ) {
    return undefined;
  }
  return {
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    totalTokens:
      raw.total_tokens ??
      (raw.prompt_tokens ?? 0) + (raw.completion_tokens ?? 0),
  };
}

class StreamAccumulator {
  content = '';
  private readonly partialToolCalls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  finishReason?: FinishReason;
  usage?: Usage;

  applyDelta(delta: {
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  }): void {
    if (delta.content) {
      this.content += delta.content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = this.partialToolCalls.get(tc.index) ?? {
          id: '',
          name: '',
          arguments: '',
        };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        this.partialToolCalls.set(tc.index, existing);
      }
    }
  }

  setFinishReason(reason: string | null | undefined): void {
    if (reason) {
      this.finishReason = normalizeFinishReason(reason);
    }
  }

  setUsage(raw?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }): void {
    if (!raw) return;
    this.usage = normalizeUsage(raw);
  }

  getToolCalls(): ToolCall[] {
    const result: ToolCall[] = [];
    const indices = Array.from(this.partialToolCalls.keys()).sort((a, b) => a - b);
    for (const index of indices) {
      const tc = this.partialToolCalls.get(index);
      if (tc && tc.id && tc.name) {
        result.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
      }
    }
    return result;
  }

  getChunk(): ChatStreamChunk {
    return {
      content: this.content,
      toolCalls: this.getToolCalls(),
      finishReason: this.finishReason,
      usage: this.usage,
    };
  }
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<OpenAIResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const dataLines: string[] = [];
        for (const line of part.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            dataLines.push(trimmed.slice(5).trim());
          }
        }
        if (dataLines.length === 0) continue;
        const data = dataLines.join('\n');
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const validated = openAIChatCompletionResponseSchema.safeParse(parsed);
          if (validated.success) {
            yield validated.data;
          }
        } catch {
          // Ignore malformed SSE data lines.
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data && data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const validated = openAIChatCompletionResponseSchema.safeParse(parsed);
            if (validated.success) yield validated.data;
          } catch {
            // Ignore.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}


export class OpenAICompatibleProvider implements LLMProvider {
  private readonly runtimeConfig: LLMRuntimeConfig;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    runtimeConfig?: LLMRuntimeConfig,
  ) {
    this.runtimeConfig = runtimeConfig ?? new LLMRuntimeConfig(config);

    if (
      !this.runtimeConfig.getApiBase() ||
      !this.runtimeConfig.getApiKey() ||
      !this.runtimeConfig.getDefaultModel()
    ) {
      throw new LLMInvalidRequestError(
        'LLM_API_BASE, LLM_API_KEY, and LLM_MODEL are required',
      );
    }
  }

  getCapabilities(): ModelCapability {
    return {
      contextWindow: this.config.LLM_CONTEXT_WINDOW,
      maxOutputTokens: this.config.LLM_MAX_TOKENS,
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsReasoning: this.config.LLM_REASONING_EFFORT !== undefined,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.fetchWithRetry({ ...request, stream: false });
    const body = await this.parseJsonResponse(response);
    return this.normalizeResponse(body);
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const response = await this.fetchWithRetry({ ...request, stream: true });
    if (!response.body) {
      throw new LLMServerError('Streaming response has no body');
    }

    const accumulator = new StreamAccumulator();
    for await (const event of parseSSE(response.body)) {
      const choice = event.choices?.[0];
      if (choice?.delta) {
        accumulator.applyDelta(choice.delta);
      }
      accumulator.setFinishReason(choice?.finish_reason);
      accumulator.setUsage(event.usage);
      yield accumulator.getChunk();
    }
  }

  private buildRequestBody(request: ChatRequest): unknown {
    const messages: unknown[] = request.messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          content: message.content,
          tool_call_id: message.tool_call_id,
        };
      }
      if (
        message.role === 'assistant' &&
        message.tool_calls &&
        message.tool_calls.length > 0
      ) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          })),
        };
      }
      return { role: message.role, content: message.content };
    });

    const body: Record<string, unknown> = {
      model: getModelOverride() ?? this.runtimeConfig.getDefaultModel(),
      messages,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    if (this.config.LLM_TEMPERATURE !== undefined) {
      body.temperature = this.config.LLM_TEMPERATURE;
    }
    if (this.config.LLM_MAX_TOKENS !== undefined) {
      body.max_tokens = this.config.LLM_MAX_TOKENS;
    }
    if (this.config.LLM_REASONING_EFFORT !== undefined) {
      body.reasoning_effort = this.config.LLM_REASONING_EFFORT;
    }
    if (request.stream) {
      body.stream = true;
    }

    return body;
  }


  private async fetchWithRetry(request: ChatRequest): Promise<Response> {
    const url = `${this.runtimeConfig.getApiBase()}/chat/completions`;
    const body = JSON.stringify(this.buildRequestBody(request));
    const maxRetries = this.config.LLM_MAX_RETRIES;
    const timeoutMs = this.config.LLM_TIMEOUT_MS;

    let lastError: unknown;

    if (request.abortSignal?.aborted) {
      throw new LLMError('LLM request aborted');
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);

      let externalAbortHandler: (() => void) | undefined;
      if (request.abortSignal) {
        externalAbortHandler = () => controller.abort();
        request.abortSignal.addEventListener('abort', externalAbortHandler, { once: true });
      }

      try {
        this.logger.debug(
          { url, model: this.runtimeConfig.getDefaultModel(), attempt },
          'Sending LLM request',
        );
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.runtimeConfig.getApiKey()}`,
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await this.safeReadErrorText(response);
          throw this.classifyHttpError(response.status, errorText);
        }

        return response;
      } catch (error) {
        lastError = error;
        const normalized = this.normalizeFetchError(error, controller.signal);

        if (attempt < maxRetries && this.isRetryable(normalized)) {
          const delay = Math.min(1000, 100 * 2 ** attempt);
          this.logger.warn(
            { attempt, delay, code: normalized.code },
            'LLM request failed, retrying',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw normalized;
      } finally {
        clearTimeout(timeoutId);
        if (externalAbortHandler && request.abortSignal) {
          request.abortSignal.removeEventListener('abort', externalAbortHandler);
        }
      }
    }

    throw this.normalizeFetchError(lastError, undefined);
  }

  private safeReadErrorText(response: Response): Promise<string> {
    return response
      .clone()
      .text()
      .catch(() => '');
  }

  private classifyHttpError(status: number, body: string): LLMError {
    const context = body ? ` (${body.slice(0, 200)})` : '';
    switch (status) {
      case 400:
      case 422:
        return new LLMInvalidRequestError(`LLM rejected the request (${status})${context}`);
      case 401:
      case 403:
        return new LLMAuthenticationError(`LLM authentication failed (${status})${context}`);
      case 408:
        return new LLMTimeoutError(`LLM request timed out (${status})${context}`);
      case 429:
        return new LLMRateLimitError(`LLM rate limit hit (${status})${context}`);
      case 500:
      case 502:
      case 503:
      case 504:
        return new LLMServerError(`LLM server error (${status})${context}`);
      default:
        return new LLMServerError(`Unexpected LLM response (${status})${context}`);
    }
  }

  private normalizeFetchError(error: unknown, signal?: AbortSignal): LLMError {
    if (error instanceof LLMError) {
      return error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (signal?.reason === 'timeout') {
        return new LLMTimeoutError();
      }
      return new LLMError('LLM request aborted');
    }

    if (error instanceof TypeError) {
      return new LLMServerError('LLM network request failed', { cause: error });
    }

    return new LLMServerError(
      error instanceof Error ? error.message : 'Unknown LLM request error',
      { cause: error },
    );
  }

  private isRetryable(error: LLMError): boolean {
    return (
      error instanceof LLMTimeoutError ||
      error instanceof LLMRateLimitError ||
      error instanceof LLMServerError
    );
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new LLMServerError('LLM returned invalid JSON', { cause: error });
    }
  }

  private normalizeResponse(body: unknown): ChatResponse {
    const parsed = openAIChatCompletionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new LLMServerError('LLM returned unexpected response structure');
    }

    const choice = parsed.data.choices?.[0];
    const message = choice?.message ?? { role: 'assistant', content: '' };
    const content = message.content ?? '';

    const toolCalls: ToolCall[] =
      message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })) ?? [];

    return {
      message: {
        role: (message.role as Message['role']) ?? 'assistant',
        content,
      },
      toolCalls,
      usage: normalizeUsage(parsed.data.usage ?? {}),
      finishReason: normalizeFinishReason(choice?.finish_reason),
    };
  }
}


# LLM Provider

The agent uses a single, generic **OpenAI-compatible LLM provider**. No
vendor-specific SDKs are used. Agent Core interacts only with the internal
`LLMProvider` interface, so the underlying endpoint can be swapped without
changing core logic.

## Architecture

```
Agent Core -> LLMProvider (interface)
              ^
              |
      OpenAICompatibleProvider
              |
      POST /chat/completions
              |
      OpenAI-compatible endpoint
```

- `src/llm/types.ts` — vendor-neutral types (`Message`, `ToolCall`, `ChatRequest`, ...).
- `src/llm/errors.ts` — typed LLM errors.
- `src/llm/OpenAICompatibleProvider.ts` — the only concrete provider.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_API_BASE` | yes* | — | Base URL of the endpoint, e.g. `https://api.openai.com/v1` |
| `LLM_API_KEY` | yes* | — | API key. Must come from environment. |
| `LLM_MODEL` | yes* | — | Model name, e.g. `gpt-4o` |
| `LLM_TEMPERATURE` | no | — | Sampling temperature (0–2) |
| `LLM_MAX_TOKENS` | no | — | `max_tokens` value sent to the API |
| `LLM_CONTEXT_WINDOW` | no | — | Target context window for Agent Core |
| `LLM_REASONING_EFFORT` | no | — | `low`, `medium`, or `high`; only sent if set |
| `LLM_TIMEOUT_MS` | no | `120000` | Request timeout in milliseconds |
| `LLM_MAX_RETRIES` | no | `3` | Maximum retry attempts for retryable failures |

\* Required only when the provider is instantiated.

## Request Format

The provider builds a standard OpenAI `/chat/completions` request:

```json
{
  "model": "<LLM_MODEL>",
  "messages": [...],
  "tools": [...],               // only if tools are supplied
  "temperature": ...,           // only if configured
  "max_tokens": ...,            // only if configured
  "reasoning_effort": ...,      // only if configured
  "stream": true | false
}
```

Only configured parameters are sent. The provider does not assume that every
endpoint supports every field.

## Tool Calling

Internal tool definitions:

```ts
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
```

They are mapped to OpenAI `function` tools. The provider parses returned tool
calls into:

```ts
interface ToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON string, validated later by Tool Registry
}
```

Tool execution is **not** performed by the LLM provider.

## Streaming

`OpenAICompatibleProvider.streamChat()` returns an async iterable of
`ChatStreamChunk`. Each chunk contains the accumulated content and tool calls
so far, plus optional `finishReason` and `usage` when the model finishes.

SSE parsing handles:

- `data:` lines
- `[DONE]` termination
- partial content deltas
- partial tool-call argument deltas across multiple chunks
- disconnect / abort via `AbortController`

## Retry Behavior

Retryable errors:

- Network failures (`TypeError` from fetch)
- Timeout (`LLMTimeoutError`)
- HTTP `408`, `429`
- HTTP `500`, `502`, `503`, `504`

Non-retryable errors:

- Authentication failures (`401`, `403`)
- Invalid requests (`400`, `422`)
- Malformed tool schemas (detected by the API)

Backoff is exponential with a base of 100 ms and a cap of 1000 ms.

## Timeout

Each request uses an `AbortController`. If the request does not complete within
`LLM_TIMEOUT_MS`, it is aborted and an `LLMTimeoutError` is thrown.

## Error Classes

- `LLMError` — base class
- `LLMTimeoutError`
- `LLMAuthenticationError`
- `LLMRateLimitError`
- `LLMInvalidRequestError`
- `LLMServerError`

API keys are never included in error messages or logs.

## Security

- `LLM_API_KEY` is read exclusively from environment variables.
- The Authorization header is not logged.
- Error bodies are truncated to 200 characters and never include the API key.

## Provider Limitations

The provider is intentionally generic:

- It does not know every model's exact context length or capabilities.
- `LLM_CONTEXT_WINDOW` is only a configuration hint for Agent Core.
- Streaming support depends on the endpoint honoring `stream: true`.
- Some endpoints may expect `max_completion_tokens` instead of `max_tokens`;
  the provider currently sends `max_tokens` when `LLM_MAX_TOKENS` is set.

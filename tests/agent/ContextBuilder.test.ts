import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../../src/agent/ContextBuilder.js';

describe('ContextBuilder', () => {
  it('returns system prompt plus conversation in order', () => {
    const ctx = new ContextBuilder('SYSTEM');
    ctx.addUserMessage('hello');
    ctx.addAssistantMessage('hi', [{ id: 'c1', name: 't', arguments: '{}' }]);
    ctx.addToolResult('c1', 'result');

    const messages = ctx.getMessages();
    expect(messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
  });

  it('seeds history before the current turn', () => {
    const ctx = new ContextBuilder('S');
    ctx.seedHistory([
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'old-answer' },
    ]);
    ctx.addUserMessage('new');

    const roles = ctx.getMessages().map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('trims old history when over budget, preserving the current turn', () => {
    const ctx = new ContextBuilder('S', 40);
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (let i = 0; i < 30; i++) {
      history.push({ role: 'user', content: `u${i}` });
      history.push({ role: 'assistant', content: 'a'.repeat(20) });
    }
    ctx.seedHistory(history);

    // Add a tool-call pair that must be preserved.
    ctx.addUserMessage('final request');
    ctx.addAssistantMessage('', [{ id: 'x', name: 'tool', arguments: '{}' }]);
    ctx.addToolResult('x', 'tool output');

    const messages = ctx.getMessages();
    expect(messages[0].role).toBe('system');
    expect(messages[messages.length - 1].role).toBe('tool');
    expect(messages[messages.length - 1].tool_call_id).toBe('x');
    // The assistant tool-call message is preserved alongside its result.
    expect(messages.some((m) => m.role === 'assistant' && m.tool_calls?.length)).toBe(true);
    // History was trimmed so the total does not exceed the budget.
    expect(messages.length).toBeLessThan(history.length + 3);
  });

  it('compaction never produces a tool message without its assistant call', () => {
    const ctx = new ContextBuilder('S', 30);
    ctx.addUserMessage('task');
    ctx.addAssistantMessage('', [{ id: 'call', name: 'tool', arguments: '{}' }]);
    ctx.addToolResult('call', 'output');

    ctx.compactIfNeeded();
    const messages = ctx.getMessages();

    const toolIdx = messages.findIndex((m) => m.role === 'tool');
    expect(toolIdx).toBeGreaterThan(0);
    expect(messages[toolIdx - 1].role).toBe('assistant');
    expect(messages[toolIdx - 1].tool_calls).toBeDefined();
  });
});

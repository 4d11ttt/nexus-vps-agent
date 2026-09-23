import { describe, it, expect } from 'vitest';
import { loadSystemPrompt } from '../../src/agent/systemPrompt.js';
import pino from 'pino';

describe('loadSystemPrompt', () => {
  it('loads workspace/SOUL.md', () => {
    const logger = pino({ level: 'silent' });
    const prompt = loadSystemPrompt(logger);
    expect(prompt).toContain('autonomous');
  });

  it('falls back when path is missing', () => {
    const logger = pino({ level: 'silent' });
    const prompt = loadSystemPrompt(logger, '/nonexistent/path/SOUL.md');
    expect(prompt).toContain('autonomous');
  });
});

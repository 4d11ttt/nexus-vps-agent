import { describe, it, expect } from 'vitest';
import { splitMessage } from '../../src/telegram/formatter.js';

describe('splitMessage', () => {
  it('returns an empty array for empty text', () => {
    expect(splitMessage('')).toEqual([]);
  });

  it('returns a single chunk when text is short', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
  });

  it('splits long text at newline boundaries when possible', () => {
    const text = 'line1\nline2\nline3';
    const chunks = splitMessage(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).toBe(text);
  });

  it('falls back to hard boundaries for very long lines', () => {
    const text = 'a'.repeat(500);
    const chunks = splitMessage(text, 100);
    expect(chunks.length).toBe(5);
    expect(chunks.join('')).toBe(text);
  });

  it('does not produce chunks above the requested limit', () => {
    const text = 'a'.repeat(1000);
    const chunks = splitMessage(text, 100);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });
});


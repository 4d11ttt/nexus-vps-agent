import { describe, it, expect } from 'vitest';
import type { Context } from 'grammy';
import {
  getTelegramUserId,
  isAuthorized,
  isAuthorizedContext,
  parseAllowedUserIds,
} from '../../src/telegram/authorization.js';

function makeContext(userId?: number): Context {
  return {
    message: userId !== undefined ? { from: { id: userId } } : undefined,
    callbackQuery: undefined,
    chat: { type: 'private' },
    from: userId !== undefined ? { id: userId } : undefined,
  } as unknown as Context;
}

describe('parseAllowedUserIds', () => {
  it('parses a single ID', () => {
    expect(parseAllowedUserIds('123')).toEqual([123]);
  });

  it('parses multiple IDs and trims whitespace', () => {
    expect(parseAllowedUserIds(' 123 , 456 , 789 ')).toEqual([123, 456, 789]);
  });

  it('returns undefined for empty/undefined input', () => {
    expect(parseAllowedUserIds(undefined)).toBeUndefined();
    expect(parseAllowedUserIds('')).toBeUndefined();
    expect(parseAllowedUserIds('   ')).toBeUndefined();
  });

  it('throws for non-numeric IDs', () => {
    expect(() => parseAllowedUserIds('123,abc')).toThrow('numeric');
  });
});

describe('isAuthorized', () => {
  it('returns true when user ID is in the list', () => {
    expect(isAuthorized(2, [1, 2, 3])).toBe(true);
  });

  it('returns false when user ID is not in the list', () => {
    expect(isAuthorized(99, [1, 2, 3])).toBe(false);
  });
});

describe('isAuthorizedContext', () => {
  it('authorizes a known user', () => {
    expect(isAuthorizedContext(makeContext(42), [42, 43])).toBe(true);
  });

  it('rejects an unknown user', () => {
    expect(isAuthorizedContext(makeContext(99), [42, 43])).toBe(false);
  });

  it('rejects a context without a user', () => {
    expect(isAuthorizedContext(makeContext(undefined), [42])).toBe(false);
  });
});

describe('getTelegramUserId', () => {
  it('extracts the user ID from a message', () => {
    expect(getTelegramUserId(makeContext(7))).toBe(7);
  });

  it('returns undefined when there is no user', () => {
    expect(getTelegramUserId(makeContext(undefined))).toBeUndefined();
  });
});


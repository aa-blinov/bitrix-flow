import { describe, expect, it } from 'vitest';
import { getProjectInitials } from './utils';

describe('getProjectInitials', () => {
  it('uses only words made of letters', () => {
    expect(getProjectInitials('123 — Авандок LLM / MVP')).toBe('АL');
    expect(getProjectInitials('2026 !!!')).toBe('');
  });
});

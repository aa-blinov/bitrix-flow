import { describe, expect, it } from 'vitest';
import { timezoneOffsetString } from './task-mirror-query';

describe('timezoneOffsetString', () => {
  it('matches the local offset the browser uses for calendar day keys', () => {
    const date = new Date('2026-09-07T00:00:00');
    const minutes = -date.getTimezoneOffset();
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const expected = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    expect(timezoneOffsetString(date)).toBe(expected);
    expect(timezoneOffsetString(date)).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

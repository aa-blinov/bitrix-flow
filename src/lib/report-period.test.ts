import { describe, expect, it } from 'vitest';
import { isDay, validPeriod } from './report-period';

describe('период отчёта', () => {
  it('принимает только настоящие даты по порядку', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-99-99')).toBe(false);
    expect(validPeriod('2026-11-01', '2026-10-01')).toBe(false);
    expect(validPeriod('2026-10-01', '2026-11-01')).toBe(true);
  });
});

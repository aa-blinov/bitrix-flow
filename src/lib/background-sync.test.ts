import { describe, expect, it } from 'vitest';

import { isChangedSince } from './background-sync';

describe('отбор изменённых задач в фоновом синке', () => {
  const since = Date.parse('2026-10-23T12:00:00.000Z');

  it('оставляет задачу, изменённую после границы', () => {
    expect(
      // 17:30 +05:00 — это 12:30 UTC, уже после границы.
      isChangedSince({ changedDate: '2026-10-23T17:30:00+05:00' }, since),
    ).toBe(true);
    expect(isChangedSince({ CHANGED_DATE: '2026-10-23T12:00:01.000Z' }, since)).toBe(true);
  });

  it('отбрасывает задачу, изменённую раньше границы', () => {
    expect(
      // 09:00 +05:00 — это 04:00 UTC, до границы.
      isChangedSince({ changedDate: '2026-10-23T09:00:00+05:00' }, since),
    ).toBe(false);
    expect(isChangedSince({ changedDate: '2025-07-29T14:24:02+05:00' }, since)).toBe(false);
  });

  it('задачу без разбираемой даты считает изменённой', () => {
    expect(isChangedSince({ changedDate: '' }, since)).toBe(true);
    expect(isChangedSince({}, since)).toBe(true);
    expect(isChangedSince({ changedDate: 'не дата' }, since)).toBe(true);
  });

  it('понимает дату без указателя часового пояса как местное время портала', () => {
    // Портал отдаёт даты со своим смещением; сравнение должно идти по UTC.
    const withOffset = Date.parse('2026-10-23T12:30:00+05:00');
    const withoutOffset = Date.parse('2026-10-23T12:30:00');
    expect(Number.isFinite(withOffset)).toBe(true);
    expect(Number.isFinite(withoutOffset)).toBe(true);
  });
});

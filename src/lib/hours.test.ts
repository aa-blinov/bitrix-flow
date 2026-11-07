import { describe, expect, it } from 'vitest';
import { mirrorProjectId, weekStarts } from './hours';

describe('hours helpers', () => {
  it('reads the project like the mirror query does', () => {
    expect(mirrorProjectId({ group: { id: '10' }, groupId: '99' })).toBe('10');
    expect(mirrorProjectId({ groupId: 12 })).toBe('12');
    expect(mirrorProjectId({ GROUP_ID: '13' })).toBe('13');
    expect(mirrorProjectId({ groupId: '' })).toBe('0');
    expect(mirrorProjectId({})).toBe('0');
  });

  it('lists Mondays from the week of the start date', () => {
    expect(weekStarts('2026-03-04', '2026-03-16')).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveHourClass } from './hour-class';

describe('resolveHourClass', () => {
  it('takes the task tag regardless of case and hash', () => {
    expect(resolveHourClass(['P1', '#Брак'], 'commercial')).toEqual({
      hourClass: 'defect',
      conflict: false,
    });
  });

  it('falls back to the project class, then to unassigned', () => {
    expect(resolveHourClass(['P2'], 'presale').hourClass).toBe('presale');
    expect(resolveHourClass([], 'garbage').hourClass).toBe('unassigned');
    expect(resolveHourClass([], null).hourClass).toBe('unassigned');
  });

  it('flags two different class tags instead of picking one', () => {
    expect(resolveHourClass(['брак', 'Пресейл'], 'commercial')).toEqual({
      hourClass: 'unassigned',
      conflict: true,
    });
    expect(resolveHourClass(['брак', '#брак']).conflict).toBe(false);
  });
});

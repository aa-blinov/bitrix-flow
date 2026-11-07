import { describe, expect, it } from 'vitest';
import { resolveHourClass } from './hour-class';

describe('resolveHourClass', () => {
  it('takes the class tag regardless of case and hash', () => {
    expect(resolveHourClass(['P1', '#Часы-Брак'])).toEqual({
      hourClass: 'defect',
      conflict: false,
    });
    expect(resolveHourClass(['часы-коммерция']).hourClass).toBe('commercial');
  });

  it('sends untagged hours and lookalike tags to unassigned', () => {
    expect(resolveHourClass([]).hourClass).toBe('unassigned');
    expect(resolveHourClass(['прочее', 'брак']).hourClass).toBe('unassigned');
  });

  it('flags two different class tags instead of picking one', () => {
    expect(resolveHourClass(['часы-брак', 'часы-пресейл'])).toEqual({
      hourClass: 'unassigned',
      conflict: true,
    });
    expect(resolveHourClass(['часы-брак', '#часы-брак']).conflict).toBe(false);
  });
});

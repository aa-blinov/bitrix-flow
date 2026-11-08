import { describe, expect, it } from 'vitest';
import { resolveHourClass, resolveWithParents } from './hour-class';

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

describe('resolveWithParents', () => {
  const tags: Record<string, string[]> = {
    root: ['часы-пресейл'],
    mid: [],
    own: ['часы-брак'],
    bad: ['часы-брак', 'часы-прочее'],
  };
  const parents: Record<string, string> = {
    leaf: 'mid',
    mid: 'root',
    own: 'root',
    loopA: 'loopB',
    loopB: 'loopA',
    badChild: 'bad',
  };
  const resolve = (id: string) =>
    resolveWithParents(
      id,
      (x) => tags[x],
      (x) => parents[x] || '',
    );

  it('takes the nearest tagged ancestor', () => {
    expect(resolve('leaf')).toEqual({ hourClass: 'presale', conflict: false, inherited: true });
  });
  it('keeps the own tag over the parent', () => {
    expect(resolve('own')).toEqual({ hourClass: 'defect', conflict: false, inherited: false });
  });
  it('passes an ancestor conflict down and survives cycles', () => {
    expect(resolve('badChild').conflict).toBe(true);
    expect(resolve('loopA').hourClass).toBe('unassigned');
  });
});

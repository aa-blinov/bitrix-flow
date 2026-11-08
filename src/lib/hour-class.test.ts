import { describe, expect, it } from 'vitest';
import {
  projectHourClass,
  resolveHourClass,
  resolveWithParents,
  withProjectClass,
} from './hour-class';

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
  const resolve = (id: string, project?: 'commercial') =>
    resolveWithParents(
      id,
      (x) => tags[x],
      (x) => parents[x] || '',
      project,
    );

  it('takes the nearest tagged ancestor', () => {
    expect(resolve('leaf')).toEqual({ hourClass: 'presale', conflict: false, source: 'parent' });
  });
  it('keeps the own tag over the parent and the project', () => {
    expect(resolve('own', 'commercial')).toEqual({
      hourClass: 'defect',
      conflict: false,
      source: 'task',
    });
    expect(resolve('leaf', 'commercial').hourClass).toBe('presale');
  });
  it('falls back to the project class only without any tag', () => {
    expect(resolve('loose', 'commercial')).toEqual({
      hourClass: 'commercial',
      conflict: false,
      source: 'project',
    });
    expect(resolve('loose')).toEqual({ hourClass: 'unassigned', conflict: false, source: '' });
  });
  it('keeps a conflict visible even with a project class, survives cycles', () => {
    expect(resolve('badChild', 'commercial')).toEqual({
      hourClass: 'unassigned',
      conflict: true,
      source: '',
    });
    expect(resolve('loopA').hourClass).toBe('unassigned');
  });
});

describe('project keywords', () => {
  it('reads and rewrites the class keyword, keeping the rest', () => {
    expect(projectHourClass('клиент, Часы-Коммерция')).toBe('commercial');
    expect(projectHourClass('')).toBeNull();
    expect(projectHourClass('часы-брак,часы-прочее')).toBeNull();
    expect(withProjectClass('клиент, часы-брак', 'commercial')).toBe('клиент,часы-коммерция');
    expect(withProjectClass('клиент,часы-брак', null)).toBe('клиент');
  });
});

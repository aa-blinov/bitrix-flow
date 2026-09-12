import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterQueryParams, splitValues } from './task-filters';

describe('filterQueryParams', () => {
  it('переводит поля в параметры /api/tasks/all', () => {
    const params = filterQueryParams({
      ...EMPTY_FILTERS,
      assignee: '9,83',
      creator: '9',
      accomplice: '35',
      auditor: '35',
      deadline: 'overdue',
      stage: '683',
      hideDone: 'on',
    });
    expect(params).toMatchObject({
      assigneeId: '9,83',
      creatorId: '9',
      accompliceId: '35',
      auditorId: '35',
      deadline: 'overdue',
      stageId: '683',
      hideDone: 'true',
      status: 'all',
    });
  });

  it('пустые фильтры уходят как all', () => {
    const params = filterQueryParams(EMPTY_FILTERS);
    expect(params.hideDone).toBe('false');
    expect(new Set(Object.values(params))).toEqual(new Set(['all', 'false']));
  });
});

describe('splitValues', () => {
  it('пустое значение — это пустой список', () => {
    expect(splitValues('all', 'all')).toEqual([]);
    expect(splitValues('9,83', 'all')).toEqual(['9', '83']);
  });
});

import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterQueryParams, splitValues, viewFilters } from './task-filters';

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
      created: 'week',
      changed: 'today',
      kind: 'subtask',
      overrun: 'on',
      hideDone: 'on',
    });
    expect(params).toMatchObject({
      assigneeId: '9,83',
      creatorId: '9',
      accompliceId: '35',
      auditorId: '35',
      deadline: 'overdue',
      stageId: '683',
      created: 'week',
      changed: 'today',
      kind: 'subtask',
      overrun: 'true',
      hideDone: 'true',
      status: 'all',
    });
  });

  it('пустые фильтры уходят как all', () => {
    const params = filterQueryParams(EMPTY_FILTERS);
    expect(params.hideDone).toBe('false');
    expect(params.overrun).toBe('false');
    expect(new Set(Object.values(params))).toEqual(new Set(['all', 'false']));
  });
});

describe('splitValues', () => {
  it('пустое значение — это пустой список', () => {
    expect(splitValues('all', 'all')).toEqual([]);
    expect(splitValues('9,83', 'all')).toEqual(['9', '83']);
  });
});

describe('viewFilters', () => {
  it('читает вью, сохранённые плоскими полями', () => {
    const filters = viewFilters({
      statusFilter: 'in_progress',
      assigneeFilter: '9',
      projectFilter: '95',
      tagFilter: 'crm',
      hideDone: true,
      groupBy: 'none',
    });
    expect(filters).toMatchObject({
      status: 'in_progress',
      assignee: '9',
      project: '95',
      tag: 'crm',
      hideDone: 'on',
      creator: 'all',
    });
  });

  it('срок из старого статуса уходит в своё поле', () => {
    const filters = viewFilters({ statusFilter: 'week', assigneeFilter: 'all' });
    expect(filters.status).toBe('all');
    expect(filters.deadline).toBe('week');
  });

  it('новый формат берёт как есть', () => {
    const filters = viewFilters({
      filters: { ...EMPTY_FILTERS, creator: '9', deadline: 'week' },
      statusFilter: 'ignored',
    });
    expect(filters.creator).toBe('9');
    expect(filters.deadline).toBe('week');
    expect(filters.status).toBe('all');
  });
});

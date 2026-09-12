import { describe, expect, it } from 'vitest';
import { useKanbanStore } from './kanban';
import { EMPTY_FILTERS } from '@/lib/task-filters';

describe('kanban search filter', () => {
  it('filters tasks before they are split into stages', () => {
    useKanbanStore.setState({
      selectedProjectId: 'p1',
      taskSearch: 'нужная',
      taskFilters: EMPTY_FILTERS,
      tasks: [
        { id: '1', projectId: 'p1', title: 'Нужная задача', description: '', status: 'new' },
        { id: '2', projectId: 'p1', title: 'Другая', description: '', status: 'new' },
      ],
    } as any);
    expect(
      useKanbanStore
        .getState()
        .getFilteredTasks()
        .map((task) => task.id),
    ).toEqual(['1']);
  });
});

describe('filter scopes', () => {
  it('возвращает набор экрана при возврате на него', () => {
    useKanbanStore.setState({
      taskFilters: EMPTY_FILTERS,
      taskFiltersByScope: {},
      taskFiltersScope: '',
    } as any);
    const store = useKanbanStore.getState();

    store.enterFilterScope('all', EMPTY_FILTERS);
    useKanbanStore.getState().setTaskFilter('creator', '9');
    // Ушли на другой экран: там чисто.
    useKanbanStore.getState().enterFilterScope('project:95', EMPTY_FILTERS);
    expect(useKanbanStore.getState().taskFilters.creator).toBe('all');
    // Вернулись — набор на месте.
    useKanbanStore.getState().enterFilterScope('all', EMPTY_FILTERS);
    expect(useKanbanStore.getState().taskFilters.creator).toBe('9');
  });

  it('значения из ссылки перекрывают сохранённые', () => {
    useKanbanStore.setState({
      taskFilters: EMPTY_FILTERS,
      taskFiltersByScope: { all: { ...EMPTY_FILTERS, creator: '9', deadline: 'week' } },
      taskFiltersScope: 'other',
    } as any);
    useKanbanStore.getState().enterFilterScope('all', { ...EMPTY_FILTERS, deadline: 'overdue' });
    const filters = useKanbanStore.getState().taskFilters;
    expect(filters.deadline).toBe('overdue');
    expect(filters.creator).toBe('9');
  });
});

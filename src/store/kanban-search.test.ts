import { describe, expect, it } from 'vitest';
import { useKanbanStore } from './kanban';

describe('kanban search filter', () => {
  it('filters tasks before they are split into stages', () => {
    useKanbanStore.setState({
      selectedProjectId: 'p1',
      filters: {
        search: 'нужная',
        assigneeId: '',
        priority: '',
        status: '',
        hasDeadline: false,
        overdue: false,
        showCompleted: true,
      },
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

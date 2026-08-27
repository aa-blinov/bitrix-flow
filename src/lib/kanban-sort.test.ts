import { describe, expect, it } from 'vitest';
import { sortKanbanTasks } from './kanban-sort';

const task = (id: string, status: string, dueDate?: string) => ({ id, status, dueDate, title: id, updatedDate: '2025-01-01' });

describe('sortKanbanTasks', () => {
  it('keeps open tasks above completed ones and orders deadlines', () => {
    const sorted = sortKanbanTasks([
      task('done', 'done', '2025-01-01'), task('later', 'new', '2025-01-12'), task('soon', 'new', '2025-01-10'),
    ] as any, 'urgency');
    expect(sorted.map((item) => item.id)).toEqual(['soon', 'later', 'done']);
  });
});

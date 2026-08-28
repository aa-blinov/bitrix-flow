import type { BxTask } from '@/types/bitrix';

export type KanbanSort = 'urgency' | 'updated' | 'deadline' | 'title';

const dateValue = (value?: string) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
};

export function sortKanbanTasks(tasks: BxTask[], sort: KanbanSort): BxTask[] {
  return [...tasks].sort((left, right) => {
    if ((left.status === 'done') !== (right.status === 'done'))
      return left.status === 'done' ? 1 : -1;
    if (sort === 'title') return left.title.localeCompare(right.title, 'ru');
    if (sort === 'updated') return dateValue(right.updatedDate) - dateValue(left.updatedDate);
    const byDeadline = dateValue(left.dueDate) - dateValue(right.dueDate);
    return byDeadline || dateValue(right.updatedDate) - dateValue(left.updatedDate);
  });
}

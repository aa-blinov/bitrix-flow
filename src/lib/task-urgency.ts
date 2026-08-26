import type { BxTask } from '@/types/bitrix';

export function needsDeadlineAttention(task: Pick<BxTask, 'dueDate' | 'status'>, now = new Date()) {
  if (!task.dueDate || task.status === 'done') return false;
  const deadline = new Date(task.dueDate);
  if (Number.isNaN(deadline.getTime())) return false;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  return (dueDay.getTime() - today.getTime()) / 86_400_000 <= 1;
}

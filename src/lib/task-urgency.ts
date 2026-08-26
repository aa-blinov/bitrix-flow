import type { BxTask } from '@/types/bitrix';

function daysFromToday(value: string, now: Date): number | undefined {
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) return undefined;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  return (dueDay.getTime() - today.getTime()) / 86_400_000;
}

export function needsDeadlineAttention(task: Pick<BxTask, 'dueDate' | 'status'>, now = new Date()) {
  if (!task.dueDate || task.status === 'done') return false;
  const days = daysFromToday(task.dueDate, now);
  return days !== undefined && days <= 1;
}

export function isDueThisWeek(task: Pick<BxTask, 'dueDate' | 'status'>, now = new Date()) {
  if (!task.dueDate || task.status === 'done') return false;
  const days = daysFromToday(task.dueDate, now);
  return days !== undefined && days >= 0 && days <= 7;
}

// Колонки вида «Сроки», как в портале: задачи раскладываются по сроку относительно сегодня.

export type DeadlineBucket = 'overdue' | 'today' | 'week' | 'next' | 'later' | 'none';

export const BUCKETS: DeadlineBucket[] = ['overdue', 'today', 'week', 'next', 'later', 'none'];

const endOfDay = (date: Date) => {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
};

// Неделя с понедельника: воскресенье её последний день.
const endOfWeek = (date: Date, weeksAhead = 0) => {
  const end = endOfDay(date);
  const daysToSunday = (7 - end.getDay()) % 7;
  end.setDate(end.getDate() + daysToSunday + weeksAhead * 7);
  return end;
};

export function deadlineBucket(due: string | undefined, now = new Date()): DeadlineBucket {
  if (!due) return 'none';
  const time = new Date(due).getTime();
  if (Number.isNaN(time)) return 'none';
  if (time < now.getTime()) return 'overdue';
  if (time <= endOfDay(now).getTime()) return 'today';
  if (time <= endOfWeek(now).getTime()) return 'week';
  if (time <= endOfWeek(now, 1).getTime()) return 'next';
  return 'later';
}

/**
 * Срок, который ставит перенос в колонку: конец периода в 19:00, как рабочий день в портале.
 * В «Просрочено» и «Позже» переносить нечего: срок там не выбрать однозначно.
 */
export function bucketDeadline(
  bucket: DeadlineBucket,
  now = new Date(),
): string | null | undefined {
  if (bucket === 'none') return null;
  const at = (date: Date) => {
    const value = new Date(date);
    value.setHours(19, 0, 0, 0);
    return value.toISOString();
  };
  if (bucket === 'today') return at(now);
  if (bucket === 'week') return at(endOfWeek(now));
  if (bucket === 'next') return at(endOfWeek(now, 1));
  return undefined;
}

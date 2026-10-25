// Нагрузка команды с учётом иерархии задач. План родителя и план его подзадач нельзя
// складывать: оценка родителя обычно та же работа, что уже разложена по подзадачам, и
// сумма считала бы её дважды. Поэтому у родителя, под которым есть оценённые подзадачи
// (на любой глубине), своя оценка в план не идёт, а подзадачи считаются каждая у своего
// исполнителя и в свой срок. Если оценки нет ни у одной подзадачи, остаётся оценка родителя.
// В счётчик задач это не влияет: число в ячейке совпадает с числом задач в списке.

export type WorkloadTask = {
  id: string;
  parent: string;
  seconds: number;
  assignee: string;
  /** Срок в виде YYYY-MM-DD в часовом поясе недели, null без срока. */
  day: string | null;
  deadline: Date | null;
};

export type Bucket = { userId: string; count: number; hours: number };
export type DayBucket = Bucket & { day: string };

const NO_PARENT = new Set(['', '0', 'null', 'undefined']);

export function effectiveSeconds(tasks: Pick<WorkloadTask, 'id' | 'parent' | 'seconds'>[]) {
  const children = new Map<string, string[]>();
  const own = new Map<string, number>();
  for (const task of tasks) {
    own.set(task.id, task.seconds > 0 ? task.seconds : 0);
    if (NO_PARENT.has(task.parent)) continue;
    const list = children.get(task.parent) || [];
    list.push(task.id);
    children.set(task.parent, list);
  }

  const memo = new Map<string, boolean>();
  // visiting защищает от цикла parent -> ... -> parent в испорченных данных портала.
  const hasEstimatedDescendant = (id: string, visiting: Set<string>): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const found = (children.get(id) || []).some(
      (child) => (own.get(child) || 0) > 0 || hasEstimatedDescendant(child, visiting),
    );
    visiting.delete(id);
    memo.set(id, found);
    return found;
  };

  const result = new Map<string, number>();
  for (const task of tasks)
    result.set(task.id, hasEstimatedDescendant(task.id, new Set()) ? 0 : own.get(task.id) || 0);
  return result;
}

const hoursOf = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;

export function bucketize(
  tasks: WorkloadTask[],
  range: { weekStart: Date; weekEnd: Date; today: Date },
) {
  const seconds = effectiveSeconds(tasks);
  const days = new Map<string, DayBucket & { seconds: number }>();
  const noDeadline = new Map<string, Bucket & { seconds: number }>();
  const overdue = new Map<string, Bucket & { seconds: number }>();

  const add = <T extends Bucket & { seconds: number }>(
    map: Map<string, T>,
    key: string,
    make: () => T,
    value: number,
  ) => {
    const bucket = map.get(key) || make();
    bucket.count += 1;
    bucket.seconds += value;
    map.set(key, bucket);
  };

  for (const task of tasks) {
    const value = seconds.get(task.id) || 0;
    const inWeek =
      task.deadline && task.deadline >= range.weekStart && task.deadline < range.weekEnd;
    if (inWeek && task.day)
      add(
        days,
        `${task.assignee}|${task.day}`,
        () => ({ userId: task.assignee, day: task.day!, count: 0, hours: 0, seconds: 0 }),
        value,
      );
    if (task.day === null)
      add(
        noDeadline,
        task.assignee,
        () => ({ userId: task.assignee, count: 0, hours: 0, seconds: 0 }),
        value,
      );
    if (task.deadline && task.deadline < range.today)
      add(
        overdue,
        task.assignee,
        () => ({ userId: task.assignee, count: 0, hours: 0, seconds: 0 }),
        value,
      );
  }

  const finish = <T extends Bucket & { seconds: number }>(map: Map<string, T>) =>
    [...map.values()].map(({ seconds: total, ...bucket }) => ({
      ...bucket,
      hours: hoursOf(total),
    }));
  return { days: finish(days), noDeadline: finish(noDeadline), overdue: finish(overdue) };
}

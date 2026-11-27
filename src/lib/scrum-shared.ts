// Спринты: общее для сервера и экрана. Без MongoDB и портала, поэтому модуль можно
// импортировать в клиентский компонент, не утащив серверный код в бандл браузера.

export const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type Size = (typeof SIZES)[number];
// Футболки в очки для сумм и ёмкости: шкала Фибоначчи, чтобы L не выглядел как два S.
export const SIZE_POINTS: Record<Size, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
export const isSize = (value: unknown): value is Size => SIZES.includes(value as Size);

export type ScrumTask = {
  id: string;
  title: string;
  status: string;
  done: boolean;
  responsibleId: string;
  responsible: string;
  deadline: string | null;
  estimateHours: number;
  size: Size | null;
};

export type SprintStats = {
  tasks: number;
  done: number;
  points: number;
  donePoints: number;
  unsized: number;
  estimateHours: number;
  people: { id: string; name: string; tasks: number; points: number; estimateHours: number }[];
};

export type Sprint = {
  id: string;
  name: string;
  status: 'planned' | 'active' | 'completed';
  dateStart: string | null;
  dateEnd: string | null;
  tasks: ScrumTask[];
  stats: SprintStats;
};

export type ScrumBoard =
  | { scrum: false }
  | {
      scrum: true;
      projectId: string;
      backlogId: string | null;
      sprints: Sprint[];
      backlog: ScrumTask[];
      backlogStats: SprintStats;
    };

const round = (value: number) => Math.round(value * 100) / 100;

export function sprintStats(tasks: ScrumTask[]): SprintStats {
  const people = new Map<string, SprintStats['people'][number]>();
  let points = 0;
  let donePoints = 0;
  for (const task of tasks) {
    const value = task.size ? SIZE_POINTS[task.size] : 0;
    points += value;
    if (task.done) donePoints += value;
    const key = task.responsibleId || 'unassigned';
    const person = people.get(key) || {
      id: key,
      name: task.responsible || 'Не назначен',
      tasks: 0,
      points: 0,
      estimateHours: 0,
    };
    person.tasks += 1;
    person.points += value;
    person.estimateHours = round(person.estimateHours + task.estimateHours);
    people.set(key, person);
  }
  return {
    tasks: tasks.length,
    done: tasks.filter((task) => task.done).length,
    points,
    donePoints,
    unsized: tasks.filter((task) => !task.size).length,
    estimateHours: round(tasks.reduce((sum, task) => sum + task.estimateHours, 0)),
    people: [...people.values()].sort((a, b) => b.points - a.points || b.tasks - a.tasks),
  };
}

// Понедельник по Москве: спринт неделя с понедельника по воскресенье, как в планировании команды.
export function nextSprintDates(sprints: { dateEnd: string | null }[], today = new Date()) {
  const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const latestEnd = sprints
    .map((sprint) => (sprint.dateEnd ? day(new Date(sprint.dateEnd)) : ''))
    .filter(Boolean)
    .sort()
    .at(-1);
  const base = new Date(`${latestEnd || day(today)}T12:00:00Z`);
  // После последнего спринта или с ближайшего понедельника, если спринтов ещё нет.
  base.setUTCDate(base.getUTCDate() + 1);
  while (base.getUTCDay() !== 1) base.setUTCDate(base.getUTCDate() + 1);
  const start = base.toISOString().slice(0, 10);
  base.setUTCDate(base.getUTCDate() + 6);
  const end = base.toISOString().slice(0, 10);
  return { dateStart: `${start}T00:00:00+03:00`, dateEnd: `${end}T23:59:59+03:00` };
}

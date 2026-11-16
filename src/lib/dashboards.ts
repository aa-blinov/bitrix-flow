// Конструктор дашбордов: виджет это метрика, разрез и фильтры. Считает по тем же
// данным, что и отчёты ПМ (зеркало задач и понедельные списания), и теми же правилами
// периода, поэтому число в виджете сходится с числом в отчёте.
import { NO_PROJECT_ID } from './no-project';
import { mondayFor, portalDay } from './planned-hours';
import { isActive, isClosed, median, type ReportTask, type TimeEntry } from './pm-reports';

export const METRICS = [
  'created',
  'closed',
  'open',
  'overdue',
  'late',
  'onTime',
  'leadTime',
  'hours',
] as const;
export type Metric = (typeof METRICS)[number];

export const DIMENSIONS = ['none', 'project', 'user', 'status', 'class', 'week', 'month'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const VIEWS = ['number', 'bars', 'columns', 'table'] as const;
export type View = (typeof VIEWS)[number];

/** Метрики-срезы на сейчас: период к ним не относится, и разреза по времени у них нет. */
export const SNAPSHOT: Metric[] = ['open', 'overdue'];

export function dimensionsFor(metric: Metric): Dimension[] {
  if (metric === 'hours') return ['none', 'project', 'user', 'class', 'week', 'month'];
  if (SNAPSHOT.includes(metric)) return ['none', 'project', 'user', 'status'];
  return ['none', 'project', 'user', 'week', 'month'];
}

export type Widget = {
  id: string;
  title: string;
  metric: Metric;
  by: Dimension;
  view: View;
  projectId: string;
  userId: string;
  wide: boolean;
};

export type Dashboard = {
  id: string;
  name: string;
  /** На какой вопрос отвечает дашборд: строка под вкладками, чтобы экран читался без автора. */
  description: string;
  widgets: Widget[];
  version: number;
};

/** count у точки: из скольких задач доля или медиана этой недели. */
export type Point = { key: string; value: number | null; count: number };
/** count: сколько задач за долей или медианой, чтобы 100 % из одной задачи не читались как все. */
export type WidgetResult = { total: number | null; count: number; points: Point[] };

const DAY_MS = 86_400_000;
const inPeriod = (day: string, from: string, to: string) =>
  Boolean(day) && day >= from && day <= to;

function months(from: string, to: string) {
  const list: string[] = [];
  for (let [year, month] = from.slice(0, 7).split('-').map(Number); ;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (key > to.slice(0, 7)) return list;
    list.push(key);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
}

function weeks(from: string, to: string) {
  const list: string[] = [];
  for (let week = mondayFor(from); week <= to;) {
    list.push(week);
    const next = new Date(`${week}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    week = next.toISOString().slice(0, 10);
  }
  return list;
}

type Fact = {
  task: string;
  day: string;
  project: string;
  user: string;
  status: string;
  cls: string;
  value: number;
};

function keyOf(fact: Fact, by: Dimension) {
  if (by === 'project') return fact.project || NO_PROJECT_ID;
  if (by === 'user') return fact.user;
  if (by === 'status') return fact.status;
  if (by === 'class') return fact.cls;
  if (by === 'week') return mondayFor(fact.day);
  if (by === 'month') return fact.day.slice(0, 7);
  return '';
}

/** Задачи и часы, превращённые в факты метрики: день, измерения и значение. */
function facts(
  widget: Widget,
  data: { tasks: ReportTask[]; entries: TimeEntry[]; classes: Map<string, string> },
  from: string,
  to: string,
  now: number,
): Fact[] {
  const { metric } = widget;
  if (metric === 'hours') {
    const project = new Map(data.tasks.map((task) => [task.id, task.projectId]));
    return data.entries
      .filter((entry) => inPeriod(entry.day, from, to))
      .map((entry) => ({
        task: entry.taskId,
        day: entry.day,
        // Проект проставил загрузчик, в том числе из tasks для задачи вне зеркала.
        project: entry.projectId || project.get(entry.taskId) || NO_PROJECT_ID,
        user: entry.userId,
        status: '',
        cls: data.classes.get(entry.taskId) || 'unassigned',
        // Секунды, а не часы: округление каждого списания копит ошибку, отчёты
        // округляют только сумму.
        value: entry.seconds,
      }));
  }
  // День портала, а не сервера: в контейнере UTC, и после 21:00 по Москве «сегодня» было вчера.
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const result: Fact[] = [];
  for (const task of data.tasks) {
    const closedDay = portalDay(task.closed);
    const base = {
      task: task.id,
      project: task.projectId || NO_PROJECT_ID,
      // Пустой и нулевой ответственный это одна группа «без ответственного».
      user: task.responsibleId && task.responsibleId !== '0' ? task.responsibleId : '0',
      status: task.status,
      cls: '',
    };
    if (metric === 'created') {
      const day = portalDay(task.created);
      if (inPeriod(day, from, to)) result.push({ ...base, day, value: 1 });
    } else if (metric === 'closed') {
      if (isClosed(task) && inPeriod(closedDay, from, to))
        result.push({ ...base, day: closedDay, value: 1 });
    } else if (metric === 'open') {
      if (isActive(task)) result.push({ ...base, day: today, value: 1 });
    } else if (metric === 'overdue') {
      const deadline = Date.parse(task.deadline);
      if (isActive(task) && deadline < now) result.push({ ...base, day: today, value: 1 });
    } else if (metric === 'late' || metric === 'onTime') {
      if (!isClosed(task) || !inPeriod(closedDay, from, to)) continue;
      const deadline = Date.parse(task.deadline);
      if (!Number.isFinite(deadline)) continue;
      // До минуты, как в отчёте сроков: секунды в таблице не видны.
      const late = Math.floor(Date.parse(task.closed) / 60_000) > Math.floor(deadline / 60_000);
      if (metric === 'late' && !late) continue;
      result.push({ ...base, day: closedDay, value: metric === 'late' || !late ? 1 : 0 });
    } else if (metric === 'leadTime') {
      const days = (Date.parse(task.closed) - Date.parse(task.created)) / DAY_MS;
      // Закрытие раньше создания это сбой дат: в медиану не идёт, как в отчёте потока.
      if (isClosed(task) && inPeriod(closedDay, from, to) && Number.isFinite(days) && days >= 0)
        result.push({ ...base, day: closedDay, value: days });
    }
  }
  return result;
}

/** Сумма, медиана или доля: как метрика собирается внутри группы. */
function reduce(metric: Metric, values: number[]): number | null {
  if (metric === 'leadTime') return median(values);
  const sum = values.reduce((total, value) => total + value, 0);
  if (metric === 'onTime') return values.length ? sum / values.length : null;
  // Часы без округления: 10 секунд должны остаться ненулём, округляет показ.
  return metric === 'hours' ? sum / 3600 : sum;
}

type Data = {
  tasks: ReportTask[];
  entries: TimeEntry[];
  classes: Map<string, string>;
  /** Недели без собранных списаний: у часов по неделям это «нет данных», а не ноль. */
  missingWeeks?: string[];
  /** Задачи из tasks, которых нет в зеркале: только для названий в расшифровке часов. */
  extraTasks?: ReportTask[];
};

function scoped(widget: Widget, data: Data, from: string, to: string, now: number) {
  const by = dimensionsFor(widget.metric).includes(widget.by) ? widget.by : 'none';
  const all = facts(widget, data, from, to, now).filter(
    (fact) =>
      (!widget.projectId || fact.project === widget.projectId) &&
      (!widget.userId || fact.user === widget.userId),
  );
  return { by, all };
}

export function runWidget(
  widget: Widget,
  data: Data,
  from: string,
  to: string,
  now = Date.now(),
): WidgetResult {
  const { by, all } = scoped(widget, data, from, to, now);
  const total = reduce(
    widget.metric,
    all.map((fact) => fact.value),
  );
  const count = new Set(all.map((fact) => fact.task)).size;
  if (by === 'none') return { total, count, points: [] };

  const groups = new Map<string, number[]>();
  const tasksOf = new Map<string, Set<string>>();
  // Время идёт подряд: пустая неделя это ноль, а не дыра, иначе столбики врут о ритме.
  if (by === 'week' && from <= to) for (const week of weeks(from, to)) groups.set(week, []);
  if (by === 'month' && from <= to) for (const month of months(from, to)) groups.set(month, []);
  for (const fact of all) {
    const key = keyOf(fact, by);
    tasksOf.set(key, (tasksOf.get(key) || new Set()).add(fact.task));
    const values = groups.get(key);
    if (values) values.push(fact.value);
    else groups.set(key, [fact.value]);
  }
  const missing = new Set(widget.metric === 'hours' && by === 'week' ? data.missingWeeks : []);
  const points = [...groups].map(([key, values]) => ({
    key,
    // У медианы и доли пустая группа это «нет данных», а не ноль.
    value: missing.has(key) ? null : (reduce(widget.metric, values) ?? (values.length ? 0 : null)),
    count: tasksOf.get(key)?.size || 0,
  }));
  if (by !== 'week' && by !== 'month') points.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return { total, count, points };
}

export type DrillRow = {
  id: string;
  title: string;
  projectId: string;
  userId: string;
  value: number;
  deadline: string;
};

/** Задачи за числом или точкой графика: ПМ видит проблему и сразу идёт к ней. */
export function drillWidget(
  widget: Widget,
  data: Data,
  from: string,
  to: string,
  key: string | null,
  now = Date.now(),
): DrillRow[] {
  const { by, all } = scoped(widget, data, from, to, now);
  const byId = new Map([...(data.extraTasks || []), ...data.tasks].map((task) => [task.id, task]));
  const rows = new Map<string, DrillRow>();
  for (const fact of all) {
    if (key !== null && by !== 'none' && keyOf(fact, by) !== key) continue;
    // У часов строка это задача и человек: сумма двух людей под именем первого врала,
    // кто сколько списал. У остальных метрик факт на задачу один.
    const id = widget.metric === 'hours' ? `${fact.task}|${fact.user}` : fact.task;
    const row = rows.get(id);
    if (row) row.value += fact.value;
    else
      rows.set(id, {
        id: fact.task,
        title: byId.get(fact.task)?.title || `#${fact.task}`,
        projectId: fact.project,
        userId: fact.user,
        value: fact.value,
        deadline: byId.get(fact.task)?.deadline || '',
      });
  }
  const list = [...rows.values()];
  // Часы строки без округления: показ округляет сам, иначе строки по 20 с давали в сумме
  // 1 ч при итоге 0,56 ч.
  if (widget.metric === 'hours') for (const row of list) row.value /= 3600;
  // Наверху то, с чем ПМ идёт разбираться: самая старая просрочка, опоздания перед
  // закрытыми в срок, у остальных самое большое значение.
  if (widget.metric === 'overdue')
    return list.sort(
      (a, b) => Date.parse(a.deadline) - Date.parse(b.deadline) || Number(b.id) - Number(a.id),
    );
  if (widget.metric === 'onTime')
    return list.sort((a, b) => a.value - b.value || Number(b.id) - Number(a.id));
  return list.sort((a, b) => b.value - a.value || Number(b.id) - Number(a.id));
}

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

/** Виджет из тела запроса: только известные значения, иначе в базу ляжет что угодно. */
export function cleanWidget(raw: unknown): Widget {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const metric = pick(METRICS, value.metric, 'closed');
  return {
    id: String(value.id || '').slice(0, 64) || Math.random().toString(36).slice(2, 10),
    title: String(value.title || '').slice(0, 120),
    metric,
    by: pick(dimensionsFor(metric), value.by, 'none'),
    view: pick(VIEWS, value.view, 'number'),
    projectId: String(value.projectId || '').slice(0, 32),
    userId: String(value.userId || '').slice(0, 32),
    wide: value.wide === true,
  };
}

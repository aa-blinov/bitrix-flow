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
const SNAPSHOT: Metric[] = ['open', 'overdue'];

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

export type Dashboard = { id: string; name: string; widgets: Widget[] };

export type Point = { key: string; value: number | null };
export type WidgetResult = { total: number | null; points: Point[] };

const DAY_MS = 86_400_000;
const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
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
        day: entry.day,
        project: project.get(entry.taskId) || NO_PROJECT_ID,
        user: entry.userId,
        status: '',
        cls: data.classes.get(entry.taskId) || 'unassigned',
        value: hours(entry.seconds),
      }));
  }
  const today = new Date(now).toLocaleDateString('en-CA');
  const result: Fact[] = [];
  for (const task of data.tasks) {
    const closedDay = portalDay(task.closed);
    const base = {
      project: task.projectId || NO_PROJECT_ID,
      user: task.responsibleId,
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
      if (!isClosed(task) || !inPeriod(closedDay, from, to) || !task.deadline) continue;
      const late = Date.parse(task.closed) > Date.parse(task.deadline);
      if (metric === 'late' && !late) continue;
      result.push({ ...base, day: closedDay, value: metric === 'late' || !late ? 1 : 0 });
    } else if (metric === 'leadTime') {
      const days = (Date.parse(task.closed) - Date.parse(task.created)) / DAY_MS;
      if (isClosed(task) && inPeriod(closedDay, from, to) && Number.isFinite(days))
        result.push({ ...base, day: closedDay, value: Math.max(0, days) });
    }
  }
  return result;
}

/** Сумма, медиана или доля: как метрика собирается внутри группы. */
function reduce(metric: Metric, values: number[]): number | null {
  if (metric === 'leadTime') return median(values);
  if (metric === 'onTime')
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

export function runWidget(
  widget: Widget,
  data: { tasks: ReportTask[]; entries: TimeEntry[]; classes: Map<string, string> },
  from: string,
  to: string,
  now = Date.now(),
): WidgetResult {
  const by = dimensionsFor(widget.metric).includes(widget.by) ? widget.by : 'none';
  const all = facts(widget, data, from, to, now).filter(
    (fact) =>
      (!widget.projectId || fact.project === widget.projectId) &&
      (!widget.userId || fact.user === widget.userId),
  );
  const total = reduce(
    widget.metric,
    all.map((fact) => fact.value),
  );
  if (by === 'none') return { total, points: [] };

  const groups = new Map<string, number[]>();
  // Время идёт подряд: пустая неделя это ноль, а не дыра, иначе столбики врут о ритме.
  if (by === 'week') for (const week of weeks(from, to)) groups.set(week, []);
  if (by === 'month') for (const month of months(from, to)) groups.set(month, []);
  for (const fact of all) {
    const key = keyOf(fact, by);
    groups.set(key, [...(groups.get(key) || []), fact.value]);
  }
  const points = [...groups].map(([key, values]) => ({
    key,
    // У медианы и доли пустая группа это «нет данных», а не ноль.
    value: reduce(widget.metric, values) ?? (values.length ? 0 : null),
  }));
  if (by !== 'week' && by !== 'month') points.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return { total, points };
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

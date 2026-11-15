// Отчёты ПМ: чистые расчёты над зеркалом задач и понедельными списаниями. Загрузка из
// MongoDB лежит в pm-reports-data.ts, здесь только правила, чтобы их проверяли тесты.
import { portalDay } from './planned-hours';

export type ReportTask = {
  id: string;
  title: string;
  projectId: string;
  parentId: string;
  /** Статус Bitrix: 1 новая, 2 ждёт, 3 в работе, 4 ждёт контроля, 5 завершена, 6 отложена. */
  status: string;
  responsibleId: string;
  created: string;
  closed: string;
  deadline: string;
  /** Последняя активность в портале. changedDate не годится: его двигает и запись тегов. */
  activity: string;
  /** Оценка и факт по всем списаниям задачи, секунды. */
  estimate: number;
  spent: number;
};

export type TimeEntry = { userId: string; day: string; seconds: number; taskId: string };

export type Cell = string | number | null;
export type ReportRow = Record<string, Cell>;
export type ReportTable = { id: string; rows: ReportRow[] };
export type Tile = { id: string; value: number | null; filter?: string };
export type ReportResult = { tiles: Tile[]; tables: ReportTable[]; notes: string[] };

const DAY_MS = 86_400_000;
const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
const time = (value: string) => (value ? Date.parse(value) : NaN);
export const isClosed = (task: ReportTask) => task.status === '5';
/** Активная открытая задача: отложенную ставят на паузу намеренно, она не зависла. */
export const isActive = (task: ReportTask) => !isClosed(task) && task.status !== '6';

export function shiftDay(day: string, days: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const inPeriod = (value: string, from: string, to: string) => {
  const day = portalDay(value);
  return Boolean(day) && day >= from && day <= to;
};

const base = (task: ReportTask): ReportRow => ({
  taskId: task.id,
  projectId: task.projectId,
  task: task.title,
  responsibleId: task.responsibleId,
});

/**
 * План и факт по задачам с оценкой. Факт задачи включает списания подзадач без своей
 * оценки: они часть той же работы. Подзадача со своей оценкой идёт отдельной строкой и
 * в факт родителя не входит, иначе часы посчитались бы дважды.
 */
export function planFact(tasks: ReportTask[], from: string, to: string): ReportResult {
  const children = new Map<string, ReportTask[]>();
  for (const task of tasks) {
    const list = children.get(task.parentId) || [];
    list.push(task);
    children.set(task.parentId, list);
  }
  const subtreeFact = (task: ReportTask, seen = new Set<string>()): number => {
    seen.add(task.id);
    return (children.get(task.id) || [])
      .filter((child) => child.estimate <= 0 && !seen.has(child.id))
      .reduce((sum, child) => sum + subtreeFact(child, seen), task.spent);
  };
  // В отчёт идут открытые задачи и закрытые в периоде: план и факт задачи копятся за
  // всю её жизнь, поэтому период выбирает задачи, а не режет часы.
  const scope = tasks.filter(
    (task) => task.estimate > 0 && (!isClosed(task) || inPeriod(task.closed, from, to)),
  );
  const rows = scope.map((task) => {
    const plan = hours(task.estimate);
    const fact = hours(subtreeFact(task));
    return {
      ...base(task),
      state: isClosed(task) ? 'closed' : 'open',
      plan,
      fact,
      delta: Math.round((fact - plan) * 100) / 100,
      deltaShare: plan > 0 ? (fact - plan) / plan : null,
    };
  });
  const plan = rows.reduce((sum, row) => sum + row.plan, 0);
  const fact = rows.reduce((sum, row) => sum + row.fact, 0);
  const over = rows.filter((row) => row.delta > 0);
  return {
    tiles: [
      { id: 'plan', value: plan },
      { id: 'fact', value: fact },
      { id: 'overrun', value: over.reduce((sum, row) => sum + row.delta, 0) },
      { id: 'overTasks', value: over.length },
    ],
    tables: [{ id: 'tasks', rows }],
    notes: [],
  };
}

/**
 * Сроки. Закрыта с опозданием: закрыта в периоде позже дедлайна. Просрочена: активная
 * задача, дедлайн которой уже прошёл. Дни считаются от момента дедлайна, с часами.
 */
export function deadlines(
  tasks: ReportTask[],
  from: string,
  to: string,
  now = Date.now(),
): ReportResult {
  const closedWithDeadline = tasks.filter(
    (task) => isClosed(task) && task.deadline && inPeriod(task.closed, from, to),
  );
  const late = closedWithDeadline.filter((task) => time(task.closed) > time(task.deadline));
  const overdue = tasks.filter(
    (task) => isActive(task) && task.deadline && time(task.deadline) < now,
  );
  const daysLate = (end: number, deadline: string) => Math.ceil((end - time(deadline)) / DAY_MS);
  const rows: ReportRow[] = [
    ...late.map((task) => ({
      ...base(task),
      state: 'late',
      deadline: task.deadline,
      closed: task.closed,
      days: daysLate(time(task.closed), task.deadline),
    })),
    ...overdue.map((task) => ({
      ...base(task),
      state: 'overdue',
      deadline: task.deadline,
      closed: null,
      days: daysLate(now, task.deadline),
    })),
  ];
  const lateDays = late.map((task) => daysLate(time(task.closed), task.deadline));
  return {
    tiles: [
      { id: 'closedWithDeadline', value: closedWithDeadline.length },
      {
        id: 'onTime',
        value: closedWithDeadline.length
          ? (closedWithDeadline.length - late.length) / closedWithDeadline.length
          : null,
      },
      { id: 'late', value: late.length },
      { id: 'avgLate', value: lateDays.length ? median(lateDays) : null },
      { id: 'overdue', value: overdue.length },
    ],
    tables: [{ id: 'tasks', rows }],
    notes: [],
  };
}

/**
 * Поток по неделям: создано, закрыто, открытых на конец недели и медиана дней от создания
 * до закрытия у закрытых за неделю. Удалённые задачи в зеркале не живут, их здесь нет.
 */
export function throughput(tasks: ReportTask[], weeks: string[]): ReportResult {
  const rows = weeks.map((week) => {
    const end = shiftDay(week, 6);
    const created = tasks.filter((task) => inPeriod(task.created, week, end)).length;
    const closed = tasks.filter((task) => isClosed(task) && inPeriod(task.closed, week, end));
    const backlog = tasks.filter((task) => {
      const createdDay = portalDay(task.created);
      if (!createdDay || createdDay > end) return false;
      return !isClosed(task) || portalDay(task.closed) > end;
    }).length;
    const lead = median(
      closed
        .map((task) => (time(task.closed) - time(task.created)) / DAY_MS)
        .filter(Number.isFinite),
    );
    return {
      week,
      created,
      closed: closed.length,
      net: created - closed.length,
      backlog,
      lead: lead === null ? null : Math.round(lead * 10) / 10,
    };
  });
  const created = rows.reduce((sum, row) => sum + row.created, 0);
  const closed = rows.reduce((sum, row) => sum + row.closed, 0);
  const allLead = median(
    tasks
      .filter(
        (task) =>
          isClosed(task) &&
          weeks.length &&
          inPeriod(task.closed, weeks[0], shiftDay(weeks.at(-1)!, 6)),
      )
      .map((task) => (time(task.closed) - time(task.created)) / DAY_MS)
      .filter(Number.isFinite),
  );
  return {
    tiles: [
      { id: 'created', value: created },
      { id: 'closed', value: closed },
      { id: 'net', value: created - closed },
      { id: 'lead', value: allLead === null ? null : Math.round(allLead * 10) / 10 },
    ],
    tables: [{ id: 'weeks', rows }],
    notes: [],
  };
}

/** Брак против коммерции по проектам и месяцам, из тех же строк, что аналитика часов. */
export function defects(
  rows: { month: string; projectId: string; hourClass: string; hours: number }[],
): ReportResult {
  const byKey = new Map<
    string,
    { projectId: string; month: string; commercial: number; defect: number }
  >();
  for (const row of rows) {
    if (row.hourClass !== 'commercial' && row.hourClass !== 'defect') continue;
    const key = `${row.projectId}|${row.month}`;
    const item = byKey.get(key) || {
      projectId: row.projectId,
      month: row.month,
      commercial: 0,
      defect: 0,
    };
    item[row.hourClass] += row.hours;
    byKey.set(key, item);
  }
  const table = [...byKey.values()].map((item) => ({
    ...item,
    commercial: Math.round(item.commercial * 100) / 100,
    defect: Math.round(item.defect * 100) / 100,
    share: item.defect / (item.commercial + item.defect),
  }));
  const commercial = table.reduce((sum, row) => sum + row.commercial, 0);
  const defect = table.reduce((sum, row) => sum + row.defect, 0);
  return {
    tiles: [
      { id: 'defect', value: defect },
      { id: 'commercial', value: commercial },
      { id: 'share', value: commercial + defect ? defect / (commercial + defect) : null },
    ],
    tables: [{ id: 'months', rows: table }],
    notes: [],
  };
}

const isWeekday = (day: string) => {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
};

/** Рабочие дни недели внутри периода, умноженные на дневную норму, часы. */
export function weekNorm(week: string, from: string, to: string, dailyHours: number) {
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const day = shiftDay(week, i);
    if (day >= from && day <= to && isWeekday(day)) days++;
  }
  return days * dailyHours;
}

/**
 * Списание часов: сколько человек списал за неделю против нормы. Люди берутся из
 * переданного списка, а не из списаний: тот, кто не списал ничего, и есть главный сигнал.
 * ponytail: норма 8 ч в будний день без праздников, производственный календарь если понадобится.
 */
export function timesheets(
  entries: TimeEntry[],
  userIds: string[],
  weeks: string[],
  from: string,
  to: string,
  closedNoTime: ReportTask[],
  dailyHours = 8,
): ReportResult {
  const logged = new Map<string, number>();
  for (const entry of entries) {
    if (entry.day < from || entry.day > to) continue;
    const week = weeks.findLast((start) => start <= entry.day);
    if (!week) continue;
    const key = `${entry.userId}|${week}`;
    logged.set(key, (logged.get(key) || 0) + entry.seconds);
  }
  const rows = userIds.flatMap((userId) =>
    weeks.map((week) => {
      const norm = weekNorm(week, from, to, dailyHours);
      const fact = hours(logged.get(`${userId}|${week}`) || 0);
      return { userId, week, fact, norm, share: norm ? fact / norm : null };
    }),
  );
  const perUser = userIds.map((userId) => {
    const own = rows.filter((row) => row.userId === userId);
    const fact = own.reduce((sum, row) => sum + row.fact, 0);
    const norm = own.reduce((sum, row) => sum + row.norm, 0);
    return norm ? fact / norm : null;
  });
  return {
    tiles: [
      { id: 'fact', value: rows.reduce((sum, row) => sum + row.fact, 0) },
      { id: 'norm', value: rows.reduce((sum, row) => sum + row.norm, 0) },
      { id: 'below', value: perUser.filter((share) => share !== null && share < 0.8).length },
      { id: 'closedNoTime', value: closedNoTime.length },
    ],
    tables: [
      { id: 'weeks', rows },
      {
        id: 'closedNoTime',
        rows: closedNoTime.map((task) => ({ ...base(task), closed: task.closed })),
      },
    ],
    notes: [],
  };
}

export const STALE_REASONS = ['idle', 'overdue', 'noDeadline', 'noEstimate'] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

/** Зависшие: активные задачи с хотя бы одной причиной. Плитки считают каждую причину. */
export function stale(
  tasks: ReportTask[],
  idleDays: number,
  reason: StaleReason | null,
  now = Date.now(),
): ReportResult {
  const flagged = tasks.filter(isActive).map((task) => {
    const idle = Math.floor((now - time(task.activity)) / DAY_MS);
    const reasons: StaleReason[] = [];
    if (Number.isFinite(idle) && idle >= idleDays) reasons.push('idle');
    if (task.deadline && time(task.deadline) < now) reasons.push('overdue');
    if (!task.deadline) reasons.push('noDeadline');
    if (task.estimate <= 0) reasons.push('noEstimate');
    return { task, idle, reasons };
  });
  const count = (id: StaleReason) => flagged.filter((item) => item.reasons.includes(id)).length;
  const rows = flagged
    .filter((item) => (reason ? item.reasons.includes(reason) : item.reasons.length > 0))
    .map(({ task, idle, reasons }) => ({
      ...base(task),
      status: task.status,
      activity: task.activity,
      idle: Number.isFinite(idle) ? idle : null,
      deadline: task.deadline || null,
      reasons: reasons.join(','),
    }));
  return {
    tiles: STALE_REASONS.map((id) => ({ id, value: count(id), filter: id })),
    tables: [{ id: 'tasks', rows }],
    notes: [],
  };
}

/**
 * Отчёт клиенту по одному проекту: что закрыто за период, что в работе и сколько часов
 * списано за период по людям. Часы берутся из списаний, а не из факта задачи целиком:
 * клиенту показывают работу именно этого периода.
 */
export function clientReport(
  tasks: ReportTask[],
  entries: TimeEntry[],
  projectId: string,
  from: string,
  to: string,
): ReportResult {
  const own = tasks.filter((task) => task.projectId === projectId);
  const ids = new Set(own.map((task) => task.id));
  const periodEntries = entries.filter(
    (entry) => ids.has(entry.taskId) && entry.day >= from && entry.day <= to,
  );
  const byTask = new Map<string, number>();
  const byUser = new Map<string, number>();
  for (const entry of periodEntries) {
    byTask.set(entry.taskId, (byTask.get(entry.taskId) || 0) + entry.seconds);
    byUser.set(entry.userId, (byUser.get(entry.userId) || 0) + entry.seconds);
  }
  const done = own.filter((task) => isClosed(task) && inPeriod(task.closed, from, to));
  const open = own.filter((task) => !isClosed(task));
  return {
    tiles: [
      { id: 'done', value: done.length },
      { id: 'open', value: open.length },
      { id: 'hours', value: hours(periodEntries.reduce((sum, entry) => sum + entry.seconds, 0)) },
    ],
    tables: [
      {
        id: 'done',
        rows: done.map((task) => ({
          ...base(task),
          closed: task.closed,
          periodHours: hours(byTask.get(task.id) || 0),
        })),
      },
      {
        id: 'open',
        rows: open.map((task) => ({
          ...base(task),
          status: task.status,
          deadline: task.deadline || null,
          periodHours: hours(byTask.get(task.id) || 0),
        })),
      },
      {
        id: 'people',
        rows: [...byUser].map(([userId, seconds]) => ({ userId, hours: hours(seconds) })),
      },
    ],
    notes: [],
  };
}

// Отчёты ПМ: чистые расчёты над зеркалом задач и понедельными списаниями. Загрузка из
// MongoDB лежит в pm-reports-data.ts, здесь только правила, чтобы их проверяли тесты.
// Часы копятся в секундах и округляются только в строке ответа: сумма округлённых строк
// расходилась с итогом и сдвигала людей через порог 80 %.
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

/** Списание. projectId проставляет загрузчик: у задачи, которой нет в зеркале, он из tasks. */
export type TimeEntry = {
  userId: string;
  day: string;
  seconds: number;
  taskId: string;
  projectId?: string;
};

export type Cell = string | number | null;
export type ReportRow = Record<string, Cell>;
export type ReportTable = { id: string; rows: ReportRow[] };
/** filter: плитка оставляет в таблицах строки, у которых этот ключ есть в поле filters. */
export type Tile = { id: string; value: number | null; filter?: string };
export type ReportResult = { tiles: Tile[]; tables: ReportTable[]; notes: string[] };

const DAY_MS = 86_400_000;
export const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
/**
 * Часы строки без округления: таблица складывает строки в группах, и сумма округлённых
 * строк уходила от плитки (100 оценок по 20 с давали 1 ч вместо 0,56). Округляет показ.
 */
const exact = (seconds: number) => seconds / 3600;
const time = (value: string) => (value ? Date.parse(value) : NaN);
const minute = (value: string) => Math.floor(time(value) / 60_000);
export const isClosed = (task: ReportTask) => task.status === '5';
/** Активная открытая задача: отложенную ставят на паузу намеренно, она не зависла. */
export const isActive = (task: ReportTask) => !isClosed(task) && task.status !== '6';
const stateOf = (task: ReportTask) =>
  isClosed(task) ? 'closed' : task.status === '6' ? 'paused' : 'open';

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

const round1 = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

/**
 * План и факт по задачам с оценкой. Факт задачи включает списания подзадач без своей
 * оценки: они часть той же работы. Подзадача со своей оценкой идёт отдельной строкой и
 * в факт родителя не входит, иначе часы посчитались бы дважды. Задачи без оценки и без
 * такого родителя идут второй таблицей: иначе их часы молча выпадали из отчёта.
 */
export function planFact(
  tasks: ReportTask[],
  from: string,
  to: string,
  projectId: string | null = null,
): ReportResult {
  const children = new Map<string, ReportTask[]>();
  for (const task of tasks) {
    const list = children.get(task.parentId) || [];
    list.push(task);
    children.set(task.parentId, list);
  }
  const covered = new Set<string>();
  const subtreeFact = (task: ReportTask): number => {
    covered.add(task.id);
    return (children.get(task.id) || [])
      .filter((child) => child.estimate <= 0 && !covered.has(child.id))
      .reduce((sum, child) => sum + subtreeFact(child), task.spent);
  };
  // В отчёт идут открытые задачи и закрытые в периоде: план и факт задачи копятся за
  // всю её жизнь, поэтому период выбирает задачи, а не режет часы.
  const inScope = (task: ReportTask) => !isClosed(task) || inPeriod(task.closed, from, to);
  const scope = tasks.filter((task) => task.estimate > 0 && inScope(task));
  const measured = scope.map((task) => {
    const fact = subtreeFact(task);
    return { task, plan: task.estimate, fact, delta: fact - task.estimate };
  });
  const rows = measured.map(({ task, plan, fact, delta }) => {
    const over = delta > 0;
    return {
      ...base(task),
      state: stateOf(task),
      plan: exact(plan),
      fact: exact(fact),
      subFact: exact(fact - task.spent),
      delta: exact(delta),
      deltaShare: delta / plan,
      filters: over ? 'over' : '',
    };
  });
  const unestimated = tasks.filter(
    (task) =>
      task.estimate <= 0 &&
      task.spent > 0 &&
      !covered.has(task.id) &&
      inScope(task) &&
      (!projectId || task.projectId === projectId),
  );
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const over = measured.filter((item) => item.delta > 0);
  return {
    tiles: [
      { id: 'plan', value: exact(sum(measured.map((item) => item.plan))) },
      { id: 'fact', value: exact(sum(measured.map((item) => item.fact))) },
      { id: 'overrun', value: exact(sum(over.map((item) => item.delta))), filter: 'over' },
      { id: 'overTasks', value: over.length, filter: 'over' },
      { id: 'unestimated', value: exact(sum(unestimated.map((task) => task.spent))) },
    ],
    tables: [
      { id: 'tasks', rows },
      {
        id: 'unestimated',
        rows: unestimated.map((task) => ({
          ...base(task),
          state: stateOf(task),
          fact: exact(task.spent),
        })),
      },
    ],
    notes: [],
  };
}

/**
 * Сроки. Закрыта с опозданием: закрыта в периоде позже дедлайна. Просрочена: активная
 * задача, дедлайн которой уже прошёл. Дни считаются от момента дедлайна, с часами, и
 * округляются вверх: опоздание на час это день сверх срока.
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
  // Сравнение до минуты: таблица показывает время без секунд, и закрытие в 12:00:30 при
  // сроке 12:00 выглядело бы вовремя, а считалось опозданием.
  const isLate = (task: ReportTask) => minute(task.closed) > minute(task.deadline);
  const late = closedWithDeadline.filter(isLate);
  const overdue = tasks.filter(
    (task) => isActive(task) && task.deadline && time(task.deadline) < now,
  );
  // Дни сверх срока тоже по минутам: 12:00:30 против 12:00:00 через сутки это один день.
  const daysLate = (end: number, deadline: string) =>
    Math.ceil((Math.floor(end / 60_000) - minute(deadline)) / (DAY_MS / 60_000));
  const rows: ReportRow[] = [
    ...closedWithDeadline.map((task) => ({
      ...base(task),
      state: isLate(task) ? 'late' : 'onTime',
      deadline: task.deadline,
      closed: task.closed,
      days: isLate(task) ? daysLate(time(task.closed), task.deadline) : null,
      filters: isLate(task) ? 'closed,late' : 'closed,onTime',
    })),
    ...overdue.map((task) => ({
      ...base(task),
      state: 'overdue',
      deadline: task.deadline,
      closed: null,
      days: daysLate(now, task.deadline),
      filters: 'overdue',
    })),
  ];
  const lateDays = late.map((task) => daysLate(time(task.closed), task.deadline));
  return {
    tiles: [
      { id: 'closedWithDeadline', value: closedWithDeadline.length, filter: 'closed' },
      {
        id: 'onTime',
        value: closedWithDeadline.length
          ? (closedWithDeadline.length - late.length) / closedWithDeadline.length
          : null,
        filter: 'onTime',
      },
      { id: 'late', value: late.length, filter: 'late' },
      { id: 'avgLate', value: median(lateDays), filter: 'late' },
      { id: 'overdue', value: overdue.length, filter: 'overdue' },
    ],
    tables: [{ id: 'tasks', rows }],
    notes: [],
  };
}

/**
 * Поток по неделям: создано, закрыто, открытых на конец недели и медиана дней от создания
 * до закрытия. Крайние недели обрезаются периодом: иначе в поток со среды попадал
 * понедельник до него. Удалённые задачи в зеркале не живут, их здесь нет.
 */
export function throughput(
  tasks: ReportTask[],
  weeks: string[],
  from: string,
  to: string,
): ReportResult {
  // Закрытие раньше создания это сбой дат, а не ноль дней: в медиану такие не идут.
  const leadDays = (task: ReportTask) => {
    const days = (time(task.closed) - time(task.created)) / DAY_MS;
    return Number.isFinite(days) && days >= 0 ? days : NaN;
  };
  const rows = weeks.flatMap((week) => {
    const start = week < from ? from : week;
    const end = shiftDay(week, 6) > to ? to : shiftDay(week, 6);
    if (start > end) return [];
    const created = tasks.filter((task) => inPeriod(task.created, start, end)).length;
    const closed = tasks.filter((task) => isClosed(task) && inPeriod(task.closed, start, end));
    const backlog = tasks.filter((task) => {
      const createdDay = portalDay(task.created);
      if (!createdDay || createdDay > end) return false;
      return !isClosed(task) || portalDay(task.closed) > end;
    }).length;
    return [
      {
        week: `${start}..${end}`,
        created,
        closed: closed.length,
        net: created - closed.length,
        backlog,
        lead: round1(median(closed.map(leadDays).filter(Number.isFinite))),
      },
    ];
  });
  const createdTasks = tasks.filter((task) => inPeriod(task.created, from, to));
  const closedTasks = tasks.filter((task) => isClosed(task) && inPeriod(task.closed, from, to));
  const seen = new Set<string>();
  const taskRows: ReportRow[] = [];
  for (const task of [...createdTasks, ...closedTasks]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const wasCreated = inPeriod(task.created, from, to);
    const wasClosed = isClosed(task) && inPeriod(task.closed, from, to);
    const lead = wasClosed ? leadDays(task) : NaN;
    taskRows.push({
      ...base(task),
      created: task.created,
      closed: wasClosed ? task.closed : null,
      lead: Number.isFinite(lead) ? round1(lead) : null,
      // Плитка медианы оставляет ровно те задачи, по которым она посчитана.
      filters: [wasCreated && 'created', wasClosed && 'closed', Number.isFinite(lead) && 'lead']
        .filter(Boolean)
        .join(','),
    });
  }
  return {
    tiles: [
      { id: 'created', value: createdTasks.length, filter: 'created' },
      { id: 'closed', value: closedTasks.length, filter: 'closed' },
      { id: 'net', value: createdTasks.length - closedTasks.length },
      {
        id: 'lead',
        value: round1(median(closedTasks.map(leadDays).filter(Number.isFinite))),
        filter: 'lead',
      },
    ],
    tables: [
      { id: 'weeks', rows },
      { id: 'tasks', rows: taskRows },
    ],
    notes: [],
  };
}

/**
 * Брак против коммерции по проектам и месяцам, из тех же строк, что аналитика часов.
 * Часы других классов показываются отдельной плиткой: доля брака считается только по
 * двум классам, и без неё 1 ч брака на 1 ч коммерции выглядел как половина всей работы.
 */
export function defects(
  rows: { month: string; projectId: string; hourClass: string; hours: number }[],
  from: string,
  to: string,
): ReportResult {
  const byKey = new Map<
    string,
    { projectId: string; month: string; commercial: number; defect: number }
  >();
  let outside = 0;
  for (const row of rows) {
    if (row.hourClass !== 'commercial' && row.hourClass !== 'defect') {
      outside += row.hours;
      continue;
    }
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
  const items = [...byKey.values()];
  const table = items.map((item) => {
    const last = shiftDay(`${item.month}-01`, 31).slice(0, 7);
    const monthEnd = shiftDay(`${last}-01`, -1);
    return {
      projectId: item.projectId,
      month: item.month,
      commercial: item.commercial,
      defect: item.defect,
      share:
        item.commercial + item.defect > 0 ? item.defect / (item.commercial + item.defect) : null,
      // Границы строки для перехода в аналитику часов: месяц, обрезанный периодом.
      from: `${item.month}-01` < from ? from : `${item.month}-01`,
      to: monthEnd > to ? to : monthEnd,
    };
  });
  const commercial = items.reduce((sum, item) => sum + item.commercial, 0);
  const defect = items.reduce((sum, item) => sum + item.defect, 0);
  return {
    tiles: [
      { id: 'defect', value: defect },
      { id: 'commercial', value: commercial },
      { id: 'share', value: commercial + defect ? defect / (commercial + defect) : null },
      { id: 'outside', value: outside },
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

export type Norm = {
  dailyHours: number;
  /** Доля нормы, ниже которой человек «ниже нормы». */
  threshold: number;
  /** Своя дневная норма у людей с неполным днём. */
  perUser: Record<string, number>;
};
export const DEFAULT_NORM: Norm = { dailyHours: 8, threshold: 0.8, perUser: {} };

/**
 * Списание часов: сколько человек списал против нормы, за период и по неделям. Люди
 * берутся из переданного списка, а не из списаний: тот, кто не списал ничего, и есть
 * главный сигнал. weeks это только собранные недели: несобранная неделя не ноль, а
 * отсутствие данных, и норма за неё не начисляется. Норма и порог из настроек.
 * ponytail: будни без праздников, производственный календарь если понадобится.
 */
export function timesheets(
  entries: TimeEntry[],
  userIds: string[],
  weeks: string[],
  from: string,
  to: string,
  closedNoTime: ReportTask[],
  norm: Norm = DEFAULT_NORM,
): ReportResult {
  const daily = (userId: string) => norm.perUser[userId] ?? norm.dailyHours;
  const logged = new Map<string, number>();
  for (const entry of entries) {
    if (entry.day < from || entry.day > to) continue;
    const week = weeks.findLast((start) => start <= entry.day && shiftDay(start, 6) >= entry.day);
    if (!week) continue;
    const key = `${entry.userId}|${week}`;
    logged.set(key, (logged.get(key) || 0) + entry.seconds);
  }
  const people = userIds.map((userId) => {
    const seconds = weeks.reduce((sum, week) => sum + (logged.get(`${userId}|${week}`) || 0), 0);
    const due = weeks.reduce((sum, week) => sum + weekNorm(week, from, to, daily(userId)), 0);
    const share = due ? seconds / 3600 / due : null;
    return { userId, seconds, norm: due, share, below: share !== null && share < norm.threshold };
  });
  const below = new Set(people.filter((person) => person.below).map((person) => person.userId));
  const rows = userIds.flatMap((userId) =>
    weeks.map((week) => {
      const due = weekNorm(week, from, to, daily(userId));
      const seconds = logged.get(`${userId}|${week}`) || 0;
      return {
        userId,
        week,
        fact: exact(seconds),
        norm: due,
        share: due ? seconds / 3600 / due : null,
        filters: below.has(userId) ? 'below' : '',
      };
    }),
  );
  const total = people.reduce((sum, person) => sum + person.seconds, 0);
  return {
    tiles: [
      { id: 'fact', value: exact(total) },
      { id: 'norm', value: people.reduce((sum, person) => sum + person.norm, 0) },
      { id: 'below', value: below.size, filter: 'below' },
      { id: 'closedNoTime', value: closedNoTime.length, filter: 'closedNoTime' },
    ],
    tables: [
      {
        id: 'people',
        rows: people.map((person) => ({
          userId: person.userId,
          fact: exact(person.seconds),
          norm: person.norm,
          share: person.share,
          filters: person.below ? 'below' : '',
        })),
      },
      { id: 'weeks', rows },
      {
        id: 'closedNoTime',
        rows: closedNoTime.map((task) => ({
          ...base(task),
          closed: task.closed,
          filters: 'closedNoTime',
        })),
      },
    ],
    notes: [],
  };
}

export type ShiftEvent = {
  taskId: string;
  actorId: string;
  kind: 'moved' | 'removed';
  deadline: string;
  /** Момент переноса, ISO. */
  at: string;
};

/**
 * Переносы сроков за период: каждая смена или снятие дедлайна после первой постановки.
 * Направление не различается: в сообщении портала есть только новый срок. Повторный
 * перенос (два и больше у одной задачи) это главный сигнал, на нём плитка-фильтр.
 * Задачи, которых нет в зеркале (удалены или вне выбранного проекта), не попадают.
 */
export function shifts(
  events: ShiftEvent[],
  tasks: ReportTask[],
  from: string,
  to: string,
): ReportResult {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const inScope = events
    .filter((event) => byId.has(event.taskId) && inPeriod(event.at, from, to))
    .sort((a, b) => a.at.localeCompare(b.at));
  const perTask = new Map<string, ShiftEvent[]>();
  for (const event of inScope)
    perTask.set(event.taskId, [...(perTask.get(event.taskId) || []), event]);
  const flags = (list: ShiftEvent[]) =>
    [list.length >= 2 && 'repeat', list.some((event) => event.kind === 'removed') && 'removed']
      .filter(Boolean)
      .join(',');
  const taskRows = [...perTask].map(([id, list]) => {
    const task = byId.get(id)!;
    return {
      ...base(task),
      state: stateOf(task),
      shifts: list.length,
      last: list[list.length - 1].at,
      deadline: task.deadline || null,
      filters: flags(list),
    };
  });
  const eventRows = inScope.map((event) => {
    const task = byId.get(event.taskId)!;
    return {
      ...base(task),
      // Строка события это кто перенёс: группировка по людям показывает, кто двигает сроки.
      userId: event.actorId,
      at: event.at,
      change: event.kind,
      deadline: event.deadline || null,
      filters: flags(perTask.get(event.taskId)!),
    };
  });
  return {
    tiles: [
      { id: 'shifts', value: inScope.length },
      { id: 'tasks', value: perTask.size },
      {
        id: 'repeat',
        value: [...perTask.values()].filter((list) => list.length >= 2).length,
        filter: 'repeat',
      },
      {
        id: 'removed',
        value: inScope.filter((event) => event.kind === 'removed').length,
        filter: 'removed',
      },
    ],
    tables: [
      { id: 'tasks', rows: taskRows },
      { id: 'events', rows: eventRows },
    ],
    notes: [],
  };
}

/** Закрытые в периоде задачи без единого списания: работа была, а часов за ней нет. */
export const closedWithoutTime = (tasks: ReportTask[], from: string, to: string) =>
  tasks.filter((task) => isClosed(task) && task.spent <= 0 && inPeriod(task.closed, from, to));

export function untracked(tasks: ReportTask[], from: string, to: string): ReportResult {
  const closed = tasks.filter((task) => isClosed(task) && inPeriod(task.closed, from, to));
  const list = closedWithoutTime(tasks, from, to);
  return {
    tiles: [
      { id: 'untracked', value: list.length },
      { id: 'closed', value: closed.length },
      { id: 'share', value: closed.length ? list.length / closed.length : null },
    ],
    tables: [
      {
        id: 'tasks',
        rows: list.map((task) => ({ ...base(task), created: task.created, closed: task.closed })),
      },
    ],
    notes: [],
  };
}

export const STALE_REASONS = ['idle', 'overdue', 'noDeadline', 'noEstimate'] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

/**
 * Зависшие: активные задачи с хотя бы одной причиной. Плитки считают каждую причину.
 * Без движения: полных суток с последней активности не меньше порога. Задача без даты
 * активности считается от создания: иначе она выпадала из отчёта целиком.
 */
export function stale(tasks: ReportTask[], idleDays: number, now = Date.now()): ReportResult {
  const flagged = tasks.filter(isActive).map((task) => {
    const since = task.activity || task.created;
    const idle = Math.floor((now - time(since)) / DAY_MS);
    const reasons: StaleReason[] = [];
    if (Number.isFinite(idle) && idle >= idleDays) reasons.push('idle');
    if (task.deadline && time(task.deadline) < now) reasons.push('overdue');
    if (!task.deadline) reasons.push('noDeadline');
    if (task.estimate <= 0) reasons.push('noEstimate');
    return { task, idle, reasons };
  });
  const count = (id: StaleReason) => flagged.filter((item) => item.reasons.includes(id)).length;
  const rows = flagged
    .filter((item) => item.reasons.length > 0)
    .map(({ task, idle, reasons }) => ({
      ...base(task),
      status: task.status,
      // Даты активности нет: дни считаются от создания, но в колонке пусто, а не дата
      // создания под видом последней активности.
      activity: task.activity || null,
      idle: Number.isFinite(idle) ? idle : null,
      deadline: task.deadline || null,
      reasons: reasons.join(','),
      filters: reasons.join(','),
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
 * клиенту показывают работу именно этого периода. Часы по задачам вне «Сделано» и
 * «В работе» (закрыта раньше, отложена) идут третьим списком, чтобы сумма сходилась.
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
    (entry) =>
      (ids.has(entry.taskId) || entry.projectId === projectId) &&
      entry.day >= from &&
      entry.day <= to,
  );
  const byTask = new Map<string, number>();
  const byUser = new Map<string, number>();
  for (const entry of periodEntries) {
    byTask.set(entry.taskId, (byTask.get(entry.taskId) || 0) + entry.seconds);
    byUser.set(entry.userId, (byUser.get(entry.userId) || 0) + entry.seconds);
  }
  const done = own.filter((task) => isClosed(task) && inPeriod(task.closed, from, to));
  const open = own.filter(isActive);
  const listed = new Set([...done, ...open].map((task) => task.id));
  const titles = new Map(own.map((task) => [task.id, task]));
  const other = [...byTask.keys()].filter((id) => !listed.has(id));
  return {
    tiles: [
      { id: 'done', value: done.length },
      { id: 'open', value: open.length },
      { id: 'hours', value: exact(periodEntries.reduce((sum, entry) => sum + entry.seconds, 0)) },
    ],
    tables: [
      {
        id: 'done',
        rows: done.map((task) => ({
          ...base(task),
          closed: task.closed,
          periodHours: exact(byTask.get(task.id) || 0),
        })),
      },
      {
        id: 'open',
        rows: open.map((task) => ({
          ...base(task),
          status: task.status,
          deadline: task.deadline || null,
          periodHours: exact(byTask.get(task.id) || 0),
        })),
      },
      {
        id: 'other',
        rows: other.map((id) => {
          const task = titles.get(id);
          return {
            taskId: id,
            projectId,
            task: task?.title || `#${id}`,
            responsibleId: task?.responsibleId || '',
            status: task?.status || '',
            periodHours: exact(byTask.get(id) || 0),
          };
        }),
      },
      {
        id: 'people',
        rows: [...byUser].map(([userId, seconds]) => ({ userId, hours: exact(seconds) })),
      },
    ],
    notes: [],
  };
}

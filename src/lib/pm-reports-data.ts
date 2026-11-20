// Загрузка для отчётов ПМ. Источники те же, что у аналитики часов: зеркало задач и
// понедельные списания, которые собирает шедулер. Портал на рендер отчёта не трогаем.
import { portalTime, syncDeadlineChanges } from './deadline-changes';
import { excludedUsers, loadHours, mirrorProjectId, weekStarts } from './hours';
import { getDb } from './mongo';
import { isDay } from './report-period';
import {
  clientReport,
  deadlines,
  defects,
  isActive,
  isClosed,
  planFact,
  shiftDay,
  shifts,
  stale,
  throughput,
  timesheets,
  type ReportResult,
  type ReportTask,
  type TimeEntry,
} from './pm-reports';

export const REPORT_KINDS = [
  'plan-fact',
  'deadlines',
  'throughput',
  'defects',
  'timesheets',
  'stale',
  'shifts',
  'client',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Покрытие списаний: недели без собранного документа и недели, собранные с пропусками. */
export type Coverage = {
  missingWeeks: string[];
  partialWeeks: string[];
  /** Самый старый сбор недель периода: списаний позже него в часах может не быть. */
  collectedAt: string | null;
};

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
/** Дата, которую не разобрать, это «нет даты»: иначе NaN в сравнении засчитывал срок. */
const date = (value: unknown) => {
  const raw = text(value);
  // Календарь проверяется по префиксу: Date.parse молча превращает 30 февраля в 2 марта,
  // а день события берётся из префикса.
  return raw && isDay(raw.slice(0, 10)) && Number.isFinite(Date.parse(raw)) ? raw : '';
};
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

// Поля задачи в обоих регистрах: REST отдаёт camelCase, часть событий и старых записей
// зеркала лежит в UPPER_CASE. Так же читает общая выборка зеркала (task-mirror-query).
const FIELDS: Record<string, string[]> = {
  title: ['title', 'TITLE'],
  parentId: ['parentId', 'PARENT_ID'],
  status: ['status', 'STATUS', 'REAL_STATUS'],
  responsibleId: ['responsibleId', 'RESPONSIBLE_ID'],
  created: ['createdDate', 'CREATED_DATE'],
  closed: ['closedDate', 'CLOSED_DATE'],
  deadline: ['deadline', 'DEADLINE'],
  activity: ['activityDate', 'ACTIVITY_DATE'],
  estimate: ['timeEstimate', 'TIME_ESTIMATE'],
  spent: ['timeSpentInLogs', 'TIME_SPENT_IN_LOGS'],
};
const field = (data: Record<string, unknown>, name: string) =>
  FIELDS[name].map((key) => data[key]).find((value) => value !== undefined && value !== null);

function toReportTask(id: unknown, data: Record<string, unknown>, projectId: string): ReportTask {
  const parentId = text(field(data, 'parentId'));
  return {
    id: text(id),
    title: text(field(data, 'title')) || `#${id}`,
    projectId,
    parentId: parentId === '0' ? '' : parentId,
    status: text(field(data, 'status')),
    responsibleId: text(field(data, 'responsibleId')),
    created: date(field(data, 'created')),
    closed: date(field(data, 'closed')),
    deadline: date(field(data, 'deadline')),
    activity: date(field(data, 'activity')),
    estimate: Number(field(data, 'estimate')) || 0,
    spent: Number(field(data, 'spent')) || 0,
  };
}

async function hasMirror(memberId: string) {
  const db = await getDb();
  return Boolean(
    await db.collection('task_mirror').findOne({ member_id: memberId }, { projection: { _id: 1 } }),
  );
}

export async function loadTasks(memberId: string): Promise<ReportTask[]> {
  const db = await getDb();
  const keys = ['group', 'groupId', 'GROUP_ID', ...Object.values(FIELDS).flat()];
  const docs = await db
    .collection('task_mirror')
    .find(
      { member_id: memberId },
      { projection: Object.fromEntries([['id', 1], ...keys.map((key) => [`data.${key}`, 1])]) },
    )
    .toArray();
  const mirrored = docs.map((doc) =>
    toReportTask(doc.id, doc.data || {}, mirrorProjectId(doc.data || {})),
  );
  // Задача, которую зеркало ещё не догнало, уже лежит в tasks: без неё новая задача
  // проекта до сверки не видна ни в «В работе», ни в закрытых, даже без списаний.
  const known = new Set(mirrored.map((task) => task.id));
  const recent = await db
    .collection('tasks')
    .find({ member_id: memberId }, { projection: { id: 1, groupId: 1, data: 1 } })
    .toArray();
  const extra = recent
    .filter((doc) => !known.has(text(doc.id)))
    .map((doc) => toReportTask(doc.id, doc.data || {}, text(doc.groupId) || '0'));
  return [...mirrored, ...extra];
}

/**
 * Списания за недели. Списание задачи, которой нет ни в зеркале, ни в tasks, отброшено:
 * портал хранит списания удалённых задач, и они копились в «Без проекта». Задача из одной
 * tasks (зеркало её ещё не догнало) берёт проект оттуда. Так же считает аналитика часов.
 */
export async function loadEntries(
  memberId: string,
  weeks: string[],
  tasks: ReportTask[],
  /** Недели самого отчёта: табель читает и восемь недель до периода, но о них не судит. */
  periodWeeks: string[] = weeks,
): Promise<{ entries: TimeEntry[]; coverage: Coverage; extra: ReportTask[] }> {
  const db = await getDb();
  const docs = await db
    .collection('workload_time_task')
    .find(
      { member_id: memberId, start: { $in: weeks } },
      { projection: { start: 1, entries: 1, skipped: 1, updated_at: 1 } },
    )
    .toArray();
  const excluded = excludedUsers();
  const raw = docs
    .flatMap((doc) => (doc.entries || []) as TimeEntry[])
    .map((entry) => ({ ...entry, userId: String(entry.userId), taskId: String(entry.taskId) }))
    .filter((entry) => !excluded.has(entry.userId));
  const project = new Map(tasks.map((task) => [task.id, task.projectId]));
  const unknown = [...new Set(raw.map((entry) => entry.taskId))].filter((id) => !project.has(id));
  // Задачи из tasks, которых зеркало ещё не догнало: отчёт клиенту показывает их с
  // названием и статусом, а не безымянным #ID вне «Сделано» и «В работе».
  const extra: ReportTask[] = [];
  if (unknown.length) {
    const recent = await db
      .collection('tasks')
      .find(
        { member_id: memberId, id: { $in: [...unknown, ...unknown.map(Number)] } },
        { projection: { id: 1, groupId: 1, data: 1 } },
      )
      .toArray();
    for (const doc of recent) {
      const projectId = text(doc.groupId) || '0';
      project.set(String(doc.id), projectId);
      extra.push(toReportTask(doc.id, doc.data || {}, projectId));
    }
  }
  const seen = new Set(docs.map((doc) => String(doc.start)));
  // Свежесть периода это самый старый сбор его недель: в неделе, собранной раньше, нет
  // списаний, сделанных после её сбора.
  const collected = docs
    .filter((doc) => periodWeeks.includes(String(doc.start)))
    .map((doc) => new Date(doc.updated_at).getTime())
    .filter(Boolean);
  return {
    extra,
    entries: raw
      .filter((entry) => project.has(entry.taskId))
      .map((entry) => ({ ...entry, projectId: project.get(entry.taskId) })),
    coverage: {
      // Неделя, которая ещё не началась, не могла быть собрана: дырой её не считаем.
      missingWeeks: weeks.filter((week) => !seen.has(week) && week <= today()),
      partialWeeks: docs.filter((doc) => Number(doc.skipped) > 0).map((doc) => String(doc.start)),
      collectedAt: collected.length ? new Date(Math.min(...collected)).toISOString() : null,
    },
  };
}

export type ReportParams = {
  from: string;
  to: string;
  projectId: string | null;
  idleDays: number;
};

/**
 * emptyMirror: зеркало задач ещё не собрано, нули в отчёте значат «нет данных».
 * closedNoDate: завершённые без даты закрытия в выбранном проекте, их нельзя отнести к периоду.
 * teamIncomplete: недели до периода не собраны, состав людей табеля может быть неполным.
 */
export type ReportResponse = ReportResult & {
  coverage?: Coverage;
  excludedUsers?: number;
  emptyMirror?: boolean;
  closedNoDate?: number;
  teamIncomplete?: boolean;
};

/** Завершённые задачи без даты закрытия: ни в одну неделю их не отнести. */
export const closedNoDate = (tasks: ReportTask[], projectId: string | null) =>
  tasks.filter(
    (task) => isClosed(task) && !task.closed && (!projectId || task.projectId === projectId),
  ).length;

/** Сколько недель назад человек должен был списывать, чтобы попасть в табель периода. */
const TEAM_LOOKBACK_DAYS = 56;

export async function buildReport(
  memberId: string,
  kind: ReportKind,
  params: ReportParams,
): Promise<ReportResponse> {
  const { from, to, projectId } = params;
  const excludedCount = excludedUsers().size;
  if (kind === 'defects') {
    const report = await loadHours(memberId, from, to);
    const rows = report.rows.filter((row) => !projectId || row.projectId === projectId);
    return {
      ...defects(rows, from, to),
      coverage: {
        missingWeeks: report.missingWeeks,
        partialWeeks: report.partialWeeks,
        collectedAt: report.oldestCollectedAt,
      },
      excludedUsers: excludedCount,
      // Списания задач, которых нет ни в зеркале, ни в tasks, отброшены: при пустом
      // зеркале нули брака значат «нет данных», а не «брака нет».
      emptyMirror: !(await hasMirror(memberId)),
    };
  }
  const all = await loadTasks(memberId);
  return {
    emptyMirror: all.length === 0,
    closedNoDate: kind === 'stale' ? 0 : closedNoDate(all, projectId),
    ...(await fromTasks(memberId, kind, params, all)),
  };
}

async function fromTasks(
  memberId: string,
  kind: ReportKind,
  params: ReportParams,
  all: ReportTask[],
): Promise<ReportResponse> {
  const { from, projectId } = params;
  // Дни после сегодня ещё не прошли: норма за них не начисляется, задачи их не трогали.
  // Период целиком в будущем становится пустым: to раньше from, и ни один день в него не попадает.
  const to = from > today() ? shiftDay(from, -1) : params.to > today() ? today() : params.to;
  const weeks = weekStarts(from, to);
  const excludedCount = excludedUsers().size;
  const tasks = projectId ? all.filter((task) => task.projectId === projectId) : all;
  // Период целиком в будущем: план и факт, люди табеля и поток пустые; просрочка «сейчас»
  // в отчёте сроков от периода не зависит и остаётся.
  const future = from > today();
  if (kind === 'plan-fact' && future) return planFact([], from, to, projectId);
  if (kind === 'plan-fact')
    return planFact(projectId ? withDescendants(all, tasks) : all, from, to, projectId);
  if (kind === 'deadlines') return deadlines(tasks, from, to);
  if (kind === 'throughput') return throughput(tasks, weeks, from, to);
  if (kind === 'stale') return stale(tasks, params.idleDays);
  if (kind === 'shifts') {
    const db = await getDb();
    await syncDeadlineChanges(db, memberId);
    // Запас в сутки с обеих сторон: день переноса считается по Москве, а не по UTC.
    const docs = await db
      .collection('deadline_changes')
      .find({
        member_id: memberId,
        at: {
          $gte: new Date(`${shiftDay(from, -1)}T00:00:00Z`),
          $lte: new Date(`${shiftDay(to, 1)}T23:59:59Z`),
        },
      })
      .toArray();
    const events = docs.map((doc) => ({
      taskId: String(doc.taskId),
      actorId: String(doc.actorId),
      kind: doc.kind as 'moved' | 'removed',
      deadline: String(doc.deadline || ''),
      at: portalTime(new Date(doc.at).getTime() / 1000),
    }));
    return shifts(events, tasks, from, to);
  }
  if (kind === 'client') {
    if (!projectId) return { tiles: [], tables: [], notes: ['needProject'] };
    const { entries, coverage, extra } = await loadEntries(memberId, weeks, all);
    return {
      ...clientReport([...all, ...extra], entries, projectId, from, to),
      coverage,
      excludedUsers: excludedCount,
      closedNoDate: closedNoDate([...all, ...extra], projectId),
    };
  }
  // timesheets: люди по всему порталу, фильтр проекта к ним не относится. Команда это те,
  // кто списывал за период или за восемь недель до него, и исполнители открытых задач:
  // ушедший год назад человек с одним старым списанием нормы не получает.
  const recentFrom = shiftDay(from, -TEAM_LOOKBACK_DAYS);
  const { entries, coverage } = await loadEntries(memberId, weekStarts(recentFrom, to), all, weeks);
  const excluded = excludedUsers();
  const userIds = [
    ...new Set([
      ...entries
        .filter((entry) => entry.day >= recentFrom && entry.day <= to)
        .map((entry) => entry.userId),
      ...all.filter(isActive).map((task) => task.responsibleId),
    ]),
  ].filter((id) => !future && id && id !== '0' && !excluded.has(id));
  const missing = coverage.missingWeeks.filter((week) => weeks.includes(week));
  const closedNoTime = all.filter(
    (task) =>
      isClosed(task) &&
      task.spent <= 0 &&
      task.closed.slice(0, 10) >= from &&
      task.closed.slice(0, 10) <= to,
  );
  return {
    ...timesheets(
      entries,
      userIds,
      weeks.filter((week) => !missing.includes(week)),
      from,
      to,
      closedNoTime,
    ),
    coverage: {
      ...coverage,
      missingWeeks: missing,
      partialWeeks: coverage.partialWeeks.filter((week) => weeks.includes(week)),
    },
    excludedUsers: excludedCount,
    teamIncomplete: [...coverage.missingWeeks, ...coverage.partialWeeks].some(
      (week) => !weeks.includes(week),
    ),
  };
}

/** План и факт проекта считают подзадачи без оценки даже из другого проекта: это одна работа. */
function withDescendants(all: ReportTask[], scope: ReportTask[]) {
  const ids = new Set(scope.map((task) => task.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of all)
      if (!ids.has(task.id) && ids.has(task.parentId) && task.estimate <= 0) {
        ids.add(task.id);
        grew = true;
      }
  }
  return all.filter((task) => ids.has(task.id));
}

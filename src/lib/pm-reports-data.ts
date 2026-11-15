// Загрузка для отчётов ПМ. Источники те же, что у аналитики часов: зеркало задач и
// понедельные списания, которые собирает шедулер. Портал на рендер отчёта не трогаем.
import { excludedUsers, loadHours, mirrorProjectId, weekStarts } from './hours';
import { getDb } from './mongo';
import {
  clientReport,
  deadlines,
  defects,
  isActive,
  isClosed,
  planFact,
  stale,
  throughput,
  timesheets,
  STALE_REASONS,
  type ReportResult,
  type ReportTask,
  type StaleReason,
  type TimeEntry,
} from './pm-reports';

export const REPORT_KINDS = [
  'plan-fact',
  'deadlines',
  'throughput',
  'defects',
  'timesheets',
  'stale',
  'client',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

async function loadTasks(memberId: string): Promise<ReportTask[]> {
  const db = await getDb();
  const docs = await db
    .collection('task_mirror')
    .find(
      { member_id: memberId },
      {
        projection: Object.fromEntries([
          ['id', 1],
          ...[
            'title',
            'group',
            'groupId',
            'parentId',
            'status',
            'responsibleId',
            'createdDate',
            'closedDate',
            'deadline',
            'activityDate',
            'timeEstimate',
            'timeSpentInLogs',
          ].map((field) => [`data.${field}`, 1]),
        ]),
      },
    )
    .toArray();
  return docs.map((doc) => {
    const data = doc.data || {};
    const parentId = text(data.parentId);
    return {
      id: text(doc.id),
      title: text(data.title) || `#${doc.id}`,
      projectId: mirrorProjectId(data),
      parentId: parentId === '0' ? '' : parentId,
      status: text(data.status),
      responsibleId: text(data.responsibleId),
      created: text(data.createdDate),
      closed: text(data.closedDate),
      deadline: text(data.deadline),
      activity: text(data.activityDate),
      estimate: Number(data.timeEstimate) || 0,
      spent: Number(data.timeSpentInLogs) || 0,
    };
  });
}

async function loadEntries(memberId: string, weeks: string[] | null) {
  const db = await getDb();
  const docs = await db
    .collection('workload_time_task')
    .find(
      { member_id: memberId, ...(weeks ? { start: { $in: weeks } } : {}) },
      { projection: { start: 1, entries: 1 } },
    )
    .toArray();
  const excluded = excludedUsers();
  const entries = docs
    .flatMap((doc) => (doc.entries || []) as TimeEntry[])
    .map((entry) => ({ ...entry, userId: String(entry.userId), taskId: String(entry.taskId) }))
    .filter((entry) => !excluded.has(entry.userId));
  const starts = docs.map((doc) => String(doc.start)).sort();
  return { entries, collectedFrom: starts[0] || null };
}

export type ReportParams = {
  from: string;
  to: string;
  projectId: string | null;
  idleDays: number;
  reason: StaleReason | null;
};

/** Отчёт плюс начало собранных списаний: раньше него часов в базе нет. */
export async function buildReport(
  memberId: string,
  kind: ReportKind,
  params: ReportParams,
): Promise<ReportResult & { collectedFrom?: string | null }> {
  const { from, to, projectId } = params;
  const weeks = weekStarts(from, to);
  if (kind === 'defects') {
    const report = await loadHours(memberId, from, to);
    const rows = report.rows.filter((row) => !projectId || row.projectId === projectId);
    const result = defects(rows);
    if (report.missingWeeks.length) result.notes.push('missingWeeks');
    return result;
  }
  const all = await loadTasks(memberId);
  const tasks = projectId ? all.filter((task) => task.projectId === projectId) : all;
  if (kind === 'plan-fact')
    return planFact(projectId ? withDescendants(all, tasks) : all, from, to);
  if (kind === 'deadlines') return deadlines(tasks, from, to);
  if (kind === 'throughput') return throughput(tasks, weeks);
  if (kind === 'stale')
    return stale(
      tasks,
      params.idleDays,
      params.reason && STALE_REASONS.includes(params.reason) ? params.reason : null,
    );
  if (kind === 'client') {
    if (!projectId) return { tiles: [], tables: [], notes: ['needProject'] };
    const { entries, collectedFrom } = await loadEntries(memberId, weeks);
    return { ...clientReport(all, entries, projectId, from, to), collectedFrom };
  }
  // timesheets: люди по всему порталу, фильтр проекта к ним не относится.
  const [{ entries, collectedFrom }, history] = await Promise.all([
    loadEntries(memberId, weeks),
    loadEntries(memberId, null),
  ]);
  const excluded = excludedUsers();
  const userIds = [
    ...new Set([
      ...history.entries.map((entry) => entry.userId),
      ...all.filter(isActive).map((task) => task.responsibleId),
    ]),
  ].filter((id) => id && id !== '0' && !excluded.has(id));
  const closedNoTime = all.filter(
    (task) =>
      isClosed(task) &&
      task.spent <= 0 &&
      task.closed.slice(0, 10) >= from &&
      task.closed.slice(0, 10) <= to,
  );
  return {
    ...timesheets(entries, userIds, weeks, from, to, closedNoTime),
    collectedFrom: history.collectedFrom ?? collectedFrom,
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

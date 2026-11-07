// Факт часов для аналитики: списания из понедельных документов workload_time_task,
// проект и теги из task_mirror. Портал не трогаем: списания уже собраны шедулером,
// а запрос в Bitrix на каждый рендер дашборда упёрся бы в лимиты.
import { getDb } from './mongo';
import { resolveHourClass, type HourClassOrUnassigned } from './hour-class';
import { bitrixTaskTags, extractTaskTags, mergeTaskTags } from './task-tags';
import { planForPeriod, type PlanTask } from './planned-hours';
import { mondayFor } from './workload-time-scheduler';

export type HourRow = {
  month: string;
  projectId: string;
  userId: string;
  taskId: string;
  task: string;
  hourClass: HourClassOrUnassigned;
  conflict: boolean;
  hours: number;
};

export type HoursReport = {
  rows: HourRow[];
  /** Понедельники недель периода, за которые списаний в базе нет совсем. */
  missingWeeks: string[];
  projectClasses: Record<string, string>;
  /** План за период по проектам, часы: то же правило, что у сводки проектов. */
  projectPlans: Record<string, number>;
};

// Служебные учётки (у старого PM-дашборда это пользователь 15) не должны
// размывать доли классов, поэтому их убирают до агрегации, а не в интерфейсе.
const excludedUsers = () =>
  new Set(
    (process.env.HOURS_EXCLUDED_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

// То же правило, что groupId в task-mirror-query: верхнего project_id у большей части
// зеркала нет, проект лежит в data.group или data.groupId, а пустое значение это «без проекта».
export function mirrorProjectId(data: Record<string, any>): string {
  const raw =
    data.group && typeof data.group === 'object' ? data.group.id : (data.groupId ?? data.GROUP_ID);
  const text = raw === null || raw === undefined ? '' : String(raw);
  return text || '0';
}

export function weekStarts(from: string, to: string): string[] {
  const weeks: string[] = [];
  for (let week = mondayFor(from); week <= to;) {
    weeks.push(week);
    const next = new Date(`${week}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    week = next.toISOString().slice(0, 10);
  }
  return weeks;
}

export async function loadHours(memberId: string, from: string, to: string): Promise<HoursReport> {
  const db = await getDb();
  const weeks = weekStarts(from, to);
  const docs = await db
    .collection('workload_time_task')
    .find({ member_id: memberId, start: { $in: weeks } }, { projection: { start: 1, entries: 1 } })
    .toArray();

  const excluded = excludedUsers();
  const entries = docs
    .flatMap(
      (doc) =>
        (doc.entries || []) as { userId: string; day: string; seconds: number; taskId: string }[],
    )
    .filter((e) => e.day >= from && e.day <= to && !excluded.has(String(e.userId)));

  const taskIds = [...new Set(entries.map((e) => String(e.taskId)))];
  const [mirror, classDocs, planDocs] = await Promise.all([
    db
      .collection('task_mirror')
      .find(
        { member_id: memberId, id: { $in: [...taskIds, ...taskIds.map(Number)] } },
        {
          projection: {
            id: 1,
            'data.title': 1,
            'data.TITLE': 1,
            'data.description': 1,
            'data.DESCRIPTION': 1,
            'data.tags': 1,
            'data.TAGS': 1,
            'data.group': 1,
            'data.groupId': 1,
            'data.GROUP_ID': 1,
          },
        },
      )
      .toArray(),
    db.collection('project_hour_class').find({ member_id: memberId }).toArray(),
    // План нужен по всем задачам проекта, а не только по тем, где есть списания:
    // задача без факта как раз и показывает, сколько ещё не сделано.
    db
      .collection('task_mirror')
      .find(
        { member_id: memberId },
        {
          projection: {
            id: 1,
            'data.parentId': 1,
            'data.PARENT_ID': 1,
            'data.timeEstimate': 1,
            'data.TIME_ESTIMATE': 1,
            'data.createdDate': 1,
            'data.CREATED_DATE': 1,
            'data.deadline': 1,
            'data.DEADLINE': 1,
            'data.group': 1,
            'data.groupId': 1,
            'data.GROUP_ID': 1,
          },
        },
      )
      .toArray(),
  ]);

  const planTasks = new Map<string, PlanTask[]>();
  for (const t of planDocs) {
    const data = t.data || {};
    const projectId = mirrorProjectId(data);
    const list = planTasks.get(projectId) || [];
    list.push({
      id: String(t.id),
      parentId: String(data.parentId ?? data.PARENT_ID ?? ''),
      estimate: Number(data.timeEstimate ?? data.TIME_ESTIMATE) || 0,
      created: data.createdDate ?? data.CREATED_DATE,
      deadline: data.deadline ?? data.DEADLINE,
    });
    planTasks.set(projectId, list);
  }
  const projectPlans: Record<string, number> = {};
  for (const [projectId, list] of planTasks) {
    const seconds = planForPeriod(list, from, to);
    if (seconds > 0) projectPlans[projectId] = seconds / 3600;
  }

  const projectClasses: Record<string, string> = {};
  for (const doc of classDocs) projectClasses[String(doc.project_id)] = String(doc.hour_class);

  const tasks = new Map<string, { projectId: string; title: string; tags: string[] }>();
  for (const t of mirror) {
    const data = t.data || {};
    const title = String(data.title ?? data.TITLE ?? '');
    tasks.set(String(t.id), {
      projectId: mirrorProjectId(data),
      title,
      tags: mergeTaskTags(
        bitrixTaskTags(data.tags ?? data.TAGS),
        extractTaskTags(title, data.description ?? data.DESCRIPTION),
      ),
    });
  }

  const byKey = new Map<string, HourRow>();
  for (const e of entries) {
    const taskId = String(e.taskId);
    const task = tasks.get(taskId);
    const projectId = task?.projectId || '0';
    const { hourClass, conflict } = resolveHourClass(task?.tags || [], projectClasses[projectId]);
    const month = e.day.slice(0, 7);
    const key = `${month}|${taskId}|${e.userId}`;
    const row = byKey.get(key);
    if (row) row.hours += e.seconds / 3600;
    else
      byKey.set(key, {
        month,
        projectId,
        userId: String(e.userId),
        taskId,
        task: task?.title || `#${taskId}`,
        hourClass,
        conflict,
        hours: e.seconds / 3600,
      });
  }

  const seen = new Set(docs.map((doc) => String(doc.start)));
  return {
    rows: [...byKey.values()],
    // Будущие недели ещё не могли быть собраны, дырой их не считаем.
    missingWeeks: weeks.filter((week) => !seen.has(week) && week <= today()),
    projectClasses,
    projectPlans,
  };
}

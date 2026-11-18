// Факт часов для аналитики: списания из понедельных документов workload_time_task,
// проект и теги из task_mirror. Портал не трогаем: списания уже собраны шедулером,
// а запрос в Bitrix на каждый рендер дашборда упёрся бы в лимиты.
import { getDb } from './mongo';
import {
  classAt,
  projectHourClass,
  resolveWithParents,
  type ClassPeriod,
  type HourClass,
  type HourClassOrUnassigned,
  type HourClassSource,
} from './hour-class';
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
  /** Откуда класс: свой тег, тег предка, класс проекта или ниоткуда. */
  source: HourClassSource;
  hours: number;
};

export type HoursReport = {
  rows: HourRow[];
  /** Понедельники недель периода, за которые списаний в базе нет совсем. */
  missingWeeks: string[];
  /** Самый старый сбор среди недель периода: граница свежести всех часов отчёта. */
  oldestCollectedAt: string | null;
  /** Недели, собранные запасным путём с пропущенными задачами: часы за них занижены. */
  partialWeeks: string[];
  /** План за период по проектам, часы: то же правило, что у сводки проектов. */
  projectPlans: Record<string, number>;
  /** Когда шедулер последний раз забирал списания из портала за этот период. */
  collectedAt: string | null;
  /** Штатные теги задач из строк: выбор класса в аналитике переписывает их целиком. */
  taskTags: Record<string, string[]>;
  /** Класс по умолчанию у проектов, где он выбран: тег часы-* в ключевых словах группы. */
  projectClasses: Record<string, HourClass>;
  /** С какой минуты действует текущий класс проекта, для подписи в интерфейсе. */
  projectClassSince: Record<string, string>;
  /** Идёт сбор списаний из портала за этот период (ответ GET, а не loadHours). */
  refreshing?: boolean;
  /** Последний сбор за часть недель периода упал. */
  refreshError?: string;
};

// Служебные учётки (у старого PM-дашборда это пользователь 15) не должны
// размывать доли классов, поэтому их убирают до агрегации, а не в интерфейсе.
export const excludedUsers = () =>
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
    .find(
      { member_id: memberId, start: { $in: weeks } },
      { projection: { start: 1, entries: 1, updated_at: 1, skipped: 1 } },
    )
    .toArray();

  const excluded = excludedUsers();
  const entries = docs
    .flatMap(
      (doc) =>
        (doc.entries || []) as { userId: string; day: string; seconds: number; taskId: string }[],
    )
    .filter((e) => e.day >= from && e.day <= to && !excluded.has(String(e.userId)));

  const taskIds = [...new Set(entries.map((e) => String(e.taskId)))];
  const [mirror, planDocs, projectDocs] = await Promise.all([
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
            // Период класса проекта выбирается по дате создания задачи.
            'data.createdDate': 1,
            'data.CREATED_DATE': 1,
          },
        },
      )
      .toArray(),
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
            // Теги и название нужны предкам: класс подзадачи наследуется от родителя.
            'data.title': 1,
            'data.TITLE': 1,
            'data.description': 1,
            'data.DESCRIPTION': 1,
            'data.tags': 1,
            'data.TAGS': 1,
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
    // Ключевые слова кладёт в projects /api/dashboard и роут класса проекта: читать
    // их из портала на каждый рендер аналитики значило бы упереться в лимиты.
    db
      .collection('projects')
      .find({ member_id: memberId }, { projection: { id: 1, keywords: 1 } })
      .toArray(),
  ]);

  const projectClasses: Record<string, HourClass> = {};
  for (const project of projectDocs) {
    const hourClass = projectHourClass(project.keywords);
    if (hourClass) projectClasses[String(project.id)] = hourClass;
  }

  // Периоды смен класса: задача без своего тега получает класс, действовавший при её
  // создании, поэтому смена класса класс старых задач не переписывает. Проекты, у
  // которых класс стоит в ключевых словах, а периодов в зеркале ещё нет (разметка из
  // прежних версий), получают период с начала времён: так их история считается по
  // старому правилу, пока класс не сменят первый раз.
  const periodDocs = await db
    .collection('project_class_periods')
    .find({ member_id: memberId })
    .toArray();
  const periodsByProject = new Map<string, ClassPeriod[]>();
  for (const doc of periodDocs) {
    const projectId = String(doc.projectId);
    if (!periodsByProject.has(projectId)) periodsByProject.set(projectId, []);
    periodsByProject
      .get(projectId)!
      .push({ hourClass: doc.hourClass ?? null, since: String(doc.since || '') });
  }
  const projectClassSince: Record<string, string> = {};
  for (const [projectId, periods] of periodsByProject) {
    periods.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    const latest = periods[periods.length - 1];
    if (latest?.hourClass) projectClassSince[projectId] = latest.since;
  }
  for (const [projectId, hourClass] of Object.entries(projectClasses))
    if (!periodsByProject.has(projectId))
      periodsByProject.set(projectId, [{ hourClass, since: '' }]);

  const planTasks = new Map<string, PlanTask[]>();
  const parents = new Map<string, string>();
  const ancestorTags = new Map<string, string[]>();
  for (const t of planDocs) {
    const data = t.data || {};
    parents.set(String(t.id), String(data.parentId ?? data.PARENT_ID ?? ''));
    ancestorTags.set(
      String(t.id),
      mergeTaskTags(
        bitrixTaskTags(data.tags ?? data.TAGS),
        // Описание тоже: тег класса в описании родителя иначе наследовался, только если у
        // родителя были свои списания за период.
        extractTaskTags(
          String(data.title ?? data.TITLE ?? ''),
          data.description ?? data.DESCRIPTION,
        ),
      ),
    );
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

  const tasks = new Map<
    string,
    { projectId: string; title: string; tags: string[]; ownTags: string[]; created: string | null }
  >();
  for (const t of mirror) {
    const data = t.data || {};
    const title = String(data.title ?? data.TITLE ?? '');
    tasks.set(String(t.id), {
      projectId: mirrorProjectId(data),
      title,
      ownTags: bitrixTaskTags(data.tags ?? data.TAGS),
      tags: mergeTaskTags(
        bitrixTaskTags(data.tags ?? data.TAGS),
        extractTaskTags(title, data.description ?? data.DESCRIPTION),
      ),
      created: String(data.createdDate ?? data.CREATED_DATE ?? '') || null,
    });
  }

  // Задачи, которых нет в зеркале: либо зеркало их ещё не догнало (сверка добирает такие
  // за 10 минут), либо задачу удалили. Портал оставляет списания удалённых задач, и в
  // «Без проекта» копились часы тестовых задач. Удалённая задача пропадает из обеих
  // коллекций, поэтому часы считаем, только если задача есть хотя бы в одной из них.
  const unmirrored = taskIds.filter((id) => !tasks.has(id));
  const fallback = new Map<string, string>();
  if (unmirrored.length) {
    const docs = await db
      .collection('tasks')
      .find(
        { member_id: memberId, id: { $in: [...unmirrored, ...unmirrored.map(Number)] } },
        { projection: { id: 1, groupId: 1, data: 1 } },
      )
      .toArray();
    // Класс такой задачи считается по её же тегам и родителю из tasks: иначе тег брака
    // новой задачи терялся, и часы уходили в класс проекта.
    for (const doc of docs) {
      const id = String(doc.id);
      const data = doc.data || {};
      const title = String(data.title ?? data.TITLE ?? '');
      const ownTags = bitrixTaskTags(data.tags ?? data.TAGS);
      fallback.set(id, String(doc.groupId || '') || '0');
      tasks.set(id, {
        projectId: fallback.get(id)!,
        title,
        ownTags,
        tags: mergeTaskTags(ownTags, extractTaskTags(title, data.description ?? data.DESCRIPTION)),
        created: String(data.createdDate ?? data.CREATED_DATE ?? '') || null,
      });
      if (!parents.has(id)) parents.set(id, String(data.parentId ?? data.PARENT_ID ?? ''));
    }
  }
  // Предки задач со списаниями могут быть только в tasks, даже когда сама задача уже в
  // зеркале: без них подзадача теряла класс родителя.
  // ponytail: пять уровней вверх, глубже деревья задач не встречались.
  for (let depth = 0; depth < 5; depth++) {
    const missing = [...new Set([...parents.values()])].filter(
      (id) => id && id !== '0' && !parents.has(id) && !ancestorTags.has(id),
    );
    if (!missing.length) break;
    const ancestors = await db
      .collection('tasks')
      .find(
        { member_id: memberId, id: { $in: [...missing, ...missing.map(Number)] } },
        { projection: { id: 1, data: 1 } },
      )
      .toArray();
    if (!ancestors.length) break;
    for (const doc of ancestors) {
      const data = doc.data || {};
      parents.set(String(doc.id), String(data.parentId ?? data.PARENT_ID ?? ''));
      ancestorTags.set(
        String(doc.id),
        mergeTaskTags(
          bitrixTaskTags(data.tags ?? data.TAGS),
          extractTaskTags(
            String(data.title ?? data.TITLE ?? ''),
            data.description ?? data.DESCRIPTION,
          ),
        ),
      );
    }
  }

  const byKey = new Map<string, HourRow>();
  for (const e of entries) {
    const taskId = String(e.taskId);
    const task = tasks.get(taskId);
    if (!task && !fallback.has(taskId)) continue;
    const projectId = task?.projectId || fallback.get(taskId) || '0';
    const { hourClass, conflict, source } = resolveWithParents(
      taskId,
      (id) => tasks.get(id)?.tags ?? ancestorTags.get(id),
      (id) => parents.get(id) || '',
      // Класс проекта действует с даты: у задачи берём класс, действовавший при её
      // создании; без даты создания — текущий класс проекта.
      classAt(periodsByProject.get(projectId), task?.created ?? null),
    );
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
        source,
        hours: e.seconds / 3600,
      });
  }

  const seen = new Set(docs.map((doc) => String(doc.start)));
  const collected = docs.map((doc) => new Date(doc.updated_at).getTime()).filter(Boolean);
  // Свежесть всего периода это самый старый сбор: в неделе, собранной раньше, нет
  // списаний, сделанных после её сбора.
  const oldest = docs
    .filter((doc) => weeks.includes(String(doc.start)))
    .map((doc) => new Date(doc.updated_at).getTime())
    .filter(Boolean);
  return {
    rows: [...byKey.values()],
    // Будущие недели ещё не могли быть собраны, дырой их не считаем.
    missingWeeks: weeks.filter((week) => !seen.has(week) && week <= today()),
    partialWeeks: docs.filter((doc) => Number(doc.skipped) > 0).map((doc) => String(doc.start)),
    projectPlans,
    collectedAt: collected.length ? new Date(Math.max(...collected)).toISOString() : null,
    oldestCollectedAt: oldest.length ? new Date(Math.min(...oldest)).toISOString() : null,
    taskTags: Object.fromEntries([...tasks].map(([id, task]) => [id, task.ownTags])),
    projectClasses,
    projectClassSince,
  };
}

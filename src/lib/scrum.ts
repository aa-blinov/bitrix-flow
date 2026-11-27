// Спринты поверх скрама Битрикса. Своей сущности нет: спринт, бэклог и размер задачи живут в
// портале (tasks.api.scrum.*), здесь только сборка доски и действия от имени человека.
// Скрамом группа становится, когда у неё есть скрам-мастер (SCRUM_MASTER_ID).
import { taskMirrorStages } from './task-mirror-query';
import {
  isSize,
  sprintStats,
  nextSprintDates,
  type ScrumBoard,
  type Size,
  type Sprint,
} from './scrum-shared';

export * from './scrum-shared';

export type Call = (
  method: string,
  params?: Record<string, unknown>,
  mutation?: boolean,
  json?: boolean,
) => Promise<any>;

const DAY_MS = 86_400_000;
// Закрытые задачи старше двух недель в спринты уже не попадут: не тянем их скрам-поля.
// ponytail: на проекте с тысячами задач это сотни вызовов; кэш доски, если станет медленно.
const CLOSED_WINDOW_MS = 14 * DAY_MS;

const round = (value: number) => Math.round(value * 100) / 100;

const value = (data: Record<string, any>, camel: string, upper: string) =>
  data?.[camel] ?? data?.[upper];

async function projectTasks(memberId: string, projectId: string) {
  // Проект берём из нормализованной выборки, как список задач: project_id в зеркале есть не у
  // всех записей (на проде у двух третей), и выборка по нему теряла задачи.
  const { db, stages } = await taskMirrorStages(memberId);
  const rows = await db
    .collection('task_mirror')
    .aggregate([...stages, { $match: { groupId: projectId } }, { $project: { _id: 0, data: 1 } }])
    .toArray();
  const since = Date.now() - CLOSED_WINDOW_MS;
  return rows
    .map(({ data }) => {
      const status = String(value(data, 'status', 'STATUS') ?? '');
      const closed = Date.parse(String(value(data, 'closedDate', 'CLOSED_DATE') || '')) || 0;
      return {
        id: String(value(data, 'id', 'ID')),
        title: String(value(data, 'title', 'TITLE') || ''),
        status,
        done: status === '5',
        closed,
        responsibleId: String(
          data?.responsible?.id || value(data, 'responsibleId', 'RESPONSIBLE_ID') || '',
        ),
        responsible: String(data?.responsible?.name || data?.responsibleName || ''),
        deadline: value(data, 'deadline', 'DEADLINE') || null,
        estimateHours:
          round((Number(value(data, 'timeEstimate', 'TIME_ESTIMATE')) || 0) / 3600) || 0,
      };
    })
    .filter((task) => task.id && (!task.done || task.closed >= since));
}

/** Скрам-поля задач batch-запросом: списка задач спринта REST не отдаёт, только поштучно. */
async function scrumItems(call: Call, ids: string[]) {
  const items = new Map<string, { entityId: string; size: Size | null }>();
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    const response = await call(
      'batch',
      {
        halt: 0,
        cmd: Object.fromEntries(chunk.map((id) => [`t${id}`, `tasks.api.scrum.task.get?id=${id}`])),
      },
      false,
      true,
    );
    for (const id of chunk) {
      const item = response?.result?.[`t${id}`];
      if (item?.entityId)
        items.set(id, {
          entityId: String(item.entityId),
          size: isSize(item.storyPoints) ? item.storyPoints : null,
        });
    }
  }
  return items;
}

export async function isScrum(call: Call, projectId: string) {
  const group = await call(
    'socialnetwork.api.workgroup.get',
    { params: { groupId: projectId } },
    false,
    true,
  );
  return Number(group?.SCRUM_MASTER_ID) > 0;
}

async function backlogId(call: Call, projectId: string): Promise<string | null> {
  try {
    const backlog = await call('tasks.api.scrum.backlog.get', { id: projectId }, false, true);
    return backlog?.id ? String(backlog.id) : null;
  } catch {
    // «Backlog not found»: у свежего скрама бэклога ещё нет, его создаёт первый перенос.
    return null;
  }
}

export async function loadBoard(
  call: Call,
  memberId: string,
  projectId: string,
): Promise<ScrumBoard> {
  if (!(await isScrum(call, projectId))) return { scrum: false };
  const [backlog, sprintList, tasks] = await Promise.all([
    backlogId(call, projectId),
    call('tasks.api.scrum.sprint.list', { filter: { GROUP_ID: Number(projectId) } }, false, true),
    projectTasks(memberId, projectId),
  ]);
  const items = await scrumItems(
    call,
    tasks.map((task) => task.id),
  );
  const withSize = tasks.map(({ closed: _closed, ...task }) => ({
    ...task,
    size: items.get(task.id)?.size ?? null,
  }));
  const raw = (Array.isArray(sprintList) ? sprintList : []) as any[];
  // Завершённые спринты на доске не нужны, кроме последнего: с ним сравнивают текущий.
  const lastCompleted = raw
    .filter((sprint) => sprint.status === 'completed')
    .sort((a, b) => String(b.dateEnd).localeCompare(String(a.dateEnd)))[0];
  const sprints: Sprint[] = raw
    .filter((sprint) => sprint.status !== 'completed' || sprint === lastCompleted)
    .map((sprint) => {
      const sprintTasks = withSize.filter(
        (task) => items.get(task.id)?.entityId === String(sprint.id),
      );
      return {
        id: String(sprint.id),
        name: String(sprint.name || ''),
        status: sprint.status,
        dateStart: sprint.dateStart || null,
        dateEnd: sprint.dateEnd || null,
        tasks: sprintTasks,
        stats: sprintStats(sprintTasks),
      };
    })
    .sort(
      (a, b) =>
        ['active', 'planned', 'completed'].indexOf(a.status) -
          ['active', 'planned', 'completed'].indexOf(b.status) ||
        String(a.dateStart).localeCompare(String(b.dateStart)),
    );
  const inSprint = new Set(sprints.flatMap((sprint) => sprint.tasks.map((task) => task.id)));
  // В бэклоге всё открытое, что не в текущих спринтах: и привязанное к бэклогу, и задачи, которых
  // скрам ещё не знает (созданы до перевода проекта в скрам). Закрытые бэклогу не нужны.
  const open = sprintIds(raw);
  const backlogTasks = withSize.filter((task) => {
    if (task.done || inSprint.has(task.id)) return false;
    const entity = items.get(task.id)?.entityId;
    return !entity || !open.has(entity);
  });
  return {
    scrum: true,
    projectId,
    backlogId: backlog,
    sprints,
    backlog: backlogTasks,
    backlogStats: sprintStats(backlogTasks),
  };
}

const sprintIds = (raw: any[]) =>
  new Set(raw.filter((sprint) => sprint.status !== 'completed').map((sprint) => String(sprint.id)));

async function ensureBacklog(call: Call, projectId: string, userId: string) {
  const existing = await backlogId(call, projectId);
  if (existing) return existing;
  const created = await call(
    'tasks.api.scrum.backlog.add',
    { fields: { groupId: Number(projectId), createdBy: Number(userId) } },
    true,
    true,
  );
  if (!created?.id) throw new Error('BACKLOG_NOT_CREATED');
  return String(created.id);
}

export async function createSprint(call: Call, projectId: string, userId: string, name?: string) {
  const list = await call(
    'tasks.api.scrum.sprint.list',
    { filter: { GROUP_ID: Number(projectId) } },
    false,
    true,
  );
  const sprints = (Array.isArray(list) ? list : []) as any[];
  const dates = nextSprintDates(sprints);
  return call(
    'tasks.api.scrum.sprint.add',
    {
      fields: {
        groupId: Number(projectId),
        name: name?.trim() || `Спринт ${sprints.length + 1}`,
        createdBy: Number(userId),
        status: 'planned',
        ...dates,
      },
    },
    true,
    true,
  );
}

/** Перенос задачи в спринт или бэклог. createdBy нужен задачам, которых скрам ещё не знал. */
export async function moveTask(
  call: Call,
  projectId: string,
  userId: string,
  taskId: string,
  target: string,
) {
  const entityId = target === 'backlog' ? await ensureBacklog(call, projectId, userId) : target;
  return call(
    'tasks.api.scrum.task.update',
    { id: Number(taskId), fields: { entityId: Number(entityId), createdBy: Number(userId) } },
    true,
    true,
  );
}

export async function setSize(
  call: Call,
  projectId: string,
  userId: string,
  taskId: string,
  size: Size | '',
) {
  // Задача без скрам-записи получает её вместе с размером: в бэклоге, как новая задача скрама.
  const known = await call('tasks.api.scrum.task.get', { id: Number(taskId) }, false, true).catch(
    () => null,
  );
  const fields: Record<string, unknown> = { storyPoints: size, createdBy: Number(userId) };
  if (!known?.entityId) fields.entityId = Number(await ensureBacklog(call, projectId, userId));
  return call('tasks.api.scrum.task.update', { id: Number(taskId), fields }, true, true);
}

/**
 * Включает и выключает скрам у группы. Права проверяет портал: менять группу может её владелец,
 * модератор или админ портала. Выключение не стирает спринты, бэклог и размеры: при повторном
 * включении они возвращаются (проверено на портале).
 */
export async function setScrum(call: Call, projectId: string, userId: string, on: boolean) {
  const update = (master: number) =>
    call(
      'sonet_group.update',
      { GROUP_ID: Number(projectId), SCRUM_MASTER_ID: master },
      true,
      true,
    );
  if (!on) {
    await update(0);
    return false;
  }
  await update(Number(userId));
  // Флаг портал ставит и коллабе, и группе, где у человека нет прав на скрам, а бэклог потом не
  // создаётся («Access denied»). Без бэклога скрам не работает, поэтому откатываем флаг.
  try {
    await ensureBacklog(call, projectId, userId);
  } catch (error) {
    await update(0).catch(() => {});
    throw error;
  }
  return true;
}

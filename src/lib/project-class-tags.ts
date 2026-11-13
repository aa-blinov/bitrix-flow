// Класс проекта раскладывается тегом на его задачи. Битрикс здесь база данных: итоговый
// класс задачи должен читаться в портале с самой задачи, а не вычисляться правилом
// приложения («нет тега, значит класс проекта»).
import {
  HOUR_CLASS_TAG,
  UNASSIGNED,
  projectHourClass,
  resolveHourClass,
  type HourClass,
} from '@/lib/hour-class';
import { isMockEnabled } from '@/lib/mock-b24';
import { getDb } from '@/lib/mongo';
import { bx24OAuth } from '@/lib/oauth-client';
import { bitrixTaskTags, tagKey } from '@/lib/task-tags';

export type TaskNode = {
  id: string;
  parentId: string;
  projectId: string;
  title: string;
  tags: string[];
};
export type TagChange = { taskId: string; title: string; from: string[]; to: string[] };

const CLASS_TAG_KEYS = new Set(Object.values(HOUR_CLASS_TAG).map(tagKey));

export function withClassTag(tags: string[], hourClass: HourClass): string[] {
  return [...tags.filter((tag) => !CLASS_TAG_KEYS.has(tagKey(tag))), HOUR_CLASS_TAG[hourClass]];
}

/**
 * Нужен ли задаче тег класса проекта и какой. Свой тег старого класса проекта меняется на
 * новый: его разложила прошлая смена класса, и отличить его от ручного нельзя. Другой свой
 * тег или конфликт не трогаем. Без своего тега задача получает класс проекта, только если
 * ни у одного предка нет классового тега: иначе она следует за размеченным родителем.
 */
export function nextTags(
  task: TaskNode,
  byId: Map<string, TaskNode>,
  next: HourClass,
  previous: HourClass | null,
): string[] | null {
  const own = resolveHourClass(task.tags);
  if (own.conflict) return null;
  if (own.hourClass !== UNASSIGNED) {
    return previous && previous !== next && own.hourClass === previous
      ? withClassTag(task.tags, next)
      : null;
  }
  const seen = new Set([task.id]);
  for (let id = task.parentId; id && id !== '0' && !seen.has(id);) {
    seen.add(id);
    const parent = byId.get(id);
    if (!parent) break;
    const result = resolveHourClass(parent.tags);
    if (result.conflict || result.hourClass !== UNASSIGNED) return null;
    id = parent.parentId;
  }
  return withClassTag(task.tags, next);
}

export function planClassTags(
  tasks: TaskNode[],
  projectId: string,
  next: HourClass,
  previous: HourClass | null,
): TagChange[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const changes: TagChange[] = [];
  for (const task of tasks) {
    if (task.projectId !== projectId) continue;
    const to = nextTags(task, byId, next, previous);
    if (to) changes.push({ taskId: task.id, title: task.title, from: task.tags, to });
  }
  return changes;
}

async function loadNodes(memberId: string): Promise<TaskNode[]> {
  const db = await getDb();
  const docs = await db
    .collection('task_mirror')
    .find(
      { member_id: memberId },
      {
        projection: {
          id: 1,
          parent_id: 1,
          project_id: 1,
          'data.title': 1,
          'data.TITLE': 1,
          'data.tags': 1,
          'data.TAGS': 1,
        },
      },
    )
    .toArray();
  return docs.map((doc) => ({
    id: String(doc.id),
    parentId: String(doc.parent_id || ''),
    projectId: String(doc.project_id || '0'),
    title: String(doc.data?.title || doc.data?.TITLE || ''),
    tags: bitrixTaskTags(doc.data?.tags ?? doc.data?.TAGS),
  }));
}

export async function planProjectClassTags(
  memberId: string,
  projectId: string,
  next: HourClass,
  previous: HourClass | null,
): Promise<TagChange[]> {
  return planClassTags(await loadNodes(memberId), projectId, next, previous);
}

/**
 * Запись тегов в портал по одной задаче. Перед записью теги перечитываются из портала:
 * tasks.task.update заменяет список целиком, и тег, поставленный после снимка зеркала,
 * иначе пропал бы. Зеркало обновляем сразу, не дожидаясь события об изменении.
 */
export async function applyClassTags(
  memberId: string,
  changes: TagChange[],
  next: HourClass,
  previous: HourClass | null,
): Promise<{ done: number; failed: string[] }> {
  const db = await getDb();
  const failed: string[] = [];
  let done = 0;
  // ponytail: задачи по одной; на сотнях задач это минуты, батч tasks.task.update если станет мешать.
  for (const change of changes) {
    try {
      let tags = change.to;
      if (!isMockEnabled()) {
        const fresh = await bx24OAuth(memberId, 'tasks.task.get', {
          taskId: change.taskId,
          'select[0]': 'ID',
          'select[1]': 'TAGS',
        });
        const current = bitrixTaskTags((fresh?.task || fresh)?.tags);
        const own = resolveHourClass(current);
        if (own.conflict) continue;
        if (own.hourClass !== UNASSIGNED && !(own.hourClass === previous && previous !== next))
          continue;
        tags = withClassTag(current, next);
        // Массив тегов уходит только JSON-телом: формой со строкой fields портал отвечает
        // «Should be value of type array».
        await bx24OAuth(
          memberId,
          'tasks.task.update',
          { taskId: change.taskId, fields: { TAGS: tags } },
          { json: true },
        );
      }
      await db
        .collection('task_mirror')
        .updateOne(
          { member_id: memberId, id: change.taskId },
          { $set: { 'data.tags': Object.fromEntries(tags.map((title, i) => [i, { title }])) } },
        );
      done += 1;
    } catch (error) {
      console.warn('[project-class-tags]', change.taskId, error);
      failed.push(change.taskId);
    }
  }
  return { done, failed };
}

/** Новая задача в проекте с классом сразу получает его тег. */
export async function tagNewTask(memberId: string, taskId: string, projectId: string) {
  if (!projectId || projectId === '0') return;
  const db = await getDb();
  const project = await db
    .collection('projects')
    .findOne({ member_id: memberId, id: projectId }, { projection: { keywords: 1 } });
  const hourClass = projectHourClass(project?.keywords);
  if (!hourClass) return;
  const nodes = await loadNodes(memberId);
  const task = nodes.find((node) => node.id === taskId);
  if (!task) return;
  const to = nextTags(task, new Map(nodes.map((node) => [node.id, node])), hourClass, null);
  if (to)
    await applyClassTags(
      memberId,
      [{ taskId, title: task.title, from: task.tags, to }],
      hourClass,
      null,
    );
}

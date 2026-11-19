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
import { mirrorProjectId } from '@/lib/hours';
import { isMockEnabled } from '@/lib/mock-b24';
import { findPersonToken } from './people';
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
          'data.group': 1,
          'data.groupId': 1,
          'data.GROUP_ID': 1,
          'data.parentId': 1,
          'data.PARENT_ID': 1,
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
    // Верхних project_id и parent_id у большей части зеркала нет (записи из снимка):
    // проект и родитель лежат в данных задачи. Без этого план видел треть задач проекта.
    parentId: String(doc.data?.parentId ?? doc.data?.PARENT_ID ?? ''),
    projectId: mirrorProjectId(doc.data || {}),
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
 * Запись тегов в портал батчами. Портал не даёт нормального bulk-update задач, но
 * умеет batch: до 50 команд за один вызов. Порядок прежний — сначала свежие теги
 * задачи (tasks.task.update заменяет список целиком, и тег, поставленный после
 * снимка зеркала, иначе пропал бы), затем запись принятых; чтение и запись идут
 * пакетами, поэтому сотни задач — единицы вызовов, а не сотни. Зеркало обновляем
 * сразу, не дожидаясь события об изменении.
 */
const BATCH_SIZE = 40;

const chunk = <T>(list: T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
};

export async function applyClassTags(
  memberId: string,
  changes: TagChange[],
  next: HourClass,
  previous: HourClass | null,
  // Чьим токеном писать в портал; без него токен портала, это только для фоновой разметки.
  asUser?: string,
): Promise<{ done: number; failed: string[] }> {
  const db = await getDb();
  const failed: string[] = [];
  let done = 0;
  for (const pack of chunk(changes, BATCH_SIZE)) {
    if (isMockEnabled()) {
      // Мок-режим: портал недоступен, зеркало становится по плану.
      await writeMirror(db, memberId, pack, next);
      done += pack.length;
      continue;
    }
    try {
      // Свежие теги: по-прежнему пакетом, одной пачкой на весь набор.
      const getCmd: Record<string, string> = {};
      pack.forEach((change, index) => {
        getCmd[`g${index}`] = `tasks.task.get?taskId=${change.taskId}&select[]=ID&select[]=TAGS`;
      });
      const fresh = await bx24OAuth(
        memberId,
        'batch',
        { halt: 0, cmd: getCmd },
        { asUser, json: true },
      );
      const freshResult = fresh?.result?.result || {};

      // Решения по свежим тегам: конфликт и «чужой» тег не трогаем — правила те же,
      // что и в po-одиночном пути, только решённые задачи уезжают вторым батчем.
      const updateCmd: Record<string, string> = {};
      const decided: Array<{ change: TagChange; tags: string[] }> = [];
      pack.forEach((change, index) => {
        const freshTask = freshResult[`g${index}`];
        const current = bitrixTaskTags((freshTask?.task || freshTask)?.tags);
        const own = resolveHourClass(current);
        if (own.conflict) return;
        if (own.hourClass !== UNASSIGNED && !(own.hourClass === previous && previous !== next))
          return;
        const tags = withClassTag(current, next);
        updateCmd[`u${decided.length}`] =
          `tasks.task.update?taskId=${change.taskId}&fields=${encodeURIComponent(
            JSON.stringify({ TAGS: tags }),
          )}`;
        decided.push({ change, tags });
      });

      if (Object.keys(updateCmd).length) {
        const updated = await bx24OAuth(
          memberId,
          'batch',
          { halt: 0, cmd: updateCmd },
          { asUser, json: true },
        );
        // Ошибки команд батча лежат в result.result_error по ключу команды: задача с
        // ошибкой не валит соседние, но и не считается сделанной.
        const errors = updated?.result?.result_error || {};
        for (const [index, { change, tags }] of decided.entries()) {
          const key = `u${index}`;
          if (errors[key]) {
            console.warn('[project-class-tags]', change.taskId, errors[key]);
            failed.push(change.taskId);
          } else {
            await db.collection('task_mirror').updateOne(
              { member_id: memberId, id: change.taskId },
              {
                $set: {
                  'data.tags': Object.fromEntries(tags.map((title, i) => [i, { title }])),
                },
              },
            );
            done += 1;
          }
        }
      }
    } catch (error) {
      console.warn('[project-class-tags] batch', error);
      for (const change of pack) failed.push(change.taskId);
    }
  }
  return { done, failed };
}

// Мок-режим без портала: зеркало правим по плану, как раньше делали в одиночном пути.
async function writeMirror(
  db: Awaited<ReturnType<typeof getDb>>,
  memberId: string,
  pack: TagChange[],
  next: HourClass,
) {
  for (const change of pack) {
    const tags = withClassTag(change.to, next);
    await db
      .collection('task_mirror')
      .updateOne(
        { member_id: memberId, id: change.taskId },
        { $set: { 'data.tags': Object.fromEntries(tags.map((title, i) => [i, { title }])) } },
      );
  }
}

/** Новая задача в проекте с классом сразу получает его тег. */
export async function tagNewTask(
  memberId: string,
  taskId: string,
  projectId: string,
  creatorId?: string,
) {
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
  if (!to) return;
  // Тег ставится от имени автора задачи, если он входил в приложение: правка в истории
  // задачи не должна числиться за владельцем установки. Не входил: токен портала.
  const asUser = creatorId && (await findPersonToken(memberId, creatorId)) ? creatorId : undefined;
  await applyClassTags(
    memberId,
    [{ taskId, title: task.title, from: task.tags, to }],
    hourClass,
    null,
    asUser,
  );
}

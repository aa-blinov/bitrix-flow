import { getDb } from './mongo';
import { bx24OAuth } from './oauth-client';

const MAX_CONCURRENT_REQUESTS = 2;

type TimeEntry = { userId: string; day: string; seconds: number; taskId: string };

function dayKey(value: unknown) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function taskEntries(memberId: string, taskId: string, start: string, end: string) {
  let result: unknown;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await bx24OAuth(memberId, 'task.elapseditem.getlist', { TASKID: taskId });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
  return (Array.isArray(result) ? result : [])
    .map((item: any): TimeEntry | null => {
      const day = dayKey(item.DATE_PLAN || item.CREATED_DATE);
      if (!day || day < start || day > end) return null;
      return {
        userId: String(item.USER_ID || ''),
        day,
        seconds: Number(item.SECONDS) || 0,
        taskId,
      };
    })
    .filter((entry): entry is TimeEntry => entry !== null && Boolean(entry.userId));
}

async function globalEntries(memberId: string, start: string, end: string) {
  const entries: TimeEntry[] = [];
  for (let page = 1; ; page += 1) {
    const result = await bx24OAuth(memberId, 'task.elapseditem.getlist', [
      { ID: 'asc' },
      {},
      ['ID', 'TASK_ID', 'USER_ID', 'SECONDS', 'CREATED_DATE'],
      { NAV_PARAMS: { nPageSize: 50, iNumPage: page } },
    ]);
    const items = Array.isArray(result) ? result : result?.items || [];
    for (const item of items) {
      const day = dayKey(item.CREATED_DATE);
      if (day && day >= start && day <= end && item.USER_ID) {
        entries.push({
          userId: String(item.USER_ID),
          day,
          seconds: Number(item.SECONDS) || 0,
          taskId: String(item.TASK_ID),
        });
      }
    }
    if (items.length < 50) break;
  }
  return entries;
}

async function fallbackEntries(memberId: string, start: string, end: string) {
  const db = await getDb();
  const [mirrored, recent] = await Promise.all([
    db
      .collection('task_mirror')
      .find({ member_id: memberId }, { projection: { id: 1 } })
      .toArray(),
    db
      .collection('tasks')
      .find({ member_id: memberId }, { projection: { id: 1 } })
      .toArray(),
  ]);
  const taskIds = [
    ...new Set([...mirrored, ...recent].map((task) => String(task.id)).filter(Boolean)),
  ];
  const entries: TimeEntry[] = [];

  for (let index = 0; index < taskIds.length; index += MAX_CONCURRENT_REQUESTS) {
    const batch = await Promise.all(
      taskIds.slice(index, index + MAX_CONCURRENT_REQUESTS).map(async (taskId) => {
        try {
          return await taskEntries(memberId, taskId, start, end);
        } catch (error) {
          console.warn('[workload-time] skipped fallback task', taskId, String(error));
          return [];
        }
      }),
    );
    entries.push(...batch.flat());
  }
  return entries;
}

export async function getWorkloadTime(memberId: string, start: string) {
  const db = await getDb();
  return db.collection('workload_time_aggregate').findOne({ member_id: memberId, start });
}

export async function refreshWorkloadTime(memberId: string, start: string, end: string) {
  const db = await getDb();
  await db
    .collection('workload_time_status')
    .updateOne(
      { member_id: memberId, start },
      { $set: { refreshing: true, started_at: new Date() } },
      { upsert: true },
    );

  try {
    let entries: TimeEntry[];
    let source = 'global';
    try {
      entries = await globalEntries(memberId, start, end);
    } catch (error) {
      source = 'task-fallback';
      console.warn(
        '[workload-time] global time-log query failed; using task fallback',
        String(error),
      );
      entries = await fallbackEntries(memberId, start, end);
    }
    await db.collection('workload_time_task').deleteMany({ member_id: memberId, start });
    await db.collection('workload_time_task').insertOne({
      member_id: memberId,
      start,
      task_id: `__${source}__`,
      entries,
      updated_at: new Date(),
    });

    const rows = new Map<string, number>();
    const details: TimeEntry[] = [];
    const stored = await db
      .collection('workload_time_task')
      .find({ member_id: memberId, start })
      .toArray();
    for (const task of stored) {
      for (const entry of task.entries || []) {
        const key = `${entry.userId}:${entry.day}`;
        rows.set(key, (rows.get(key) || 0) + entry.seconds);
        details.push(entry);
      }
    }
    const updated_at = new Date();
    const data = {
      rows: [...rows].map(([key, seconds]) => {
        const [userId, day] = key.split(':');
        return { userId, day, seconds };
      }),
      details,
      updatedAt: updated_at.toISOString(),
    };
    await db
      .collection('workload_time_aggregate')
      .updateOne(
        { member_id: memberId, start },
        { $set: { ...data, updated_at } },
        { upsert: true },
      );
    return data;
  } finally {
    await db
      .collection('workload_time_status')
      .updateOne(
        { member_id: memberId, start },
        { $set: { refreshing: false, finished_at: new Date() } },
        { upsert: true },
      );
  }
}

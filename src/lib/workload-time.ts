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
  const result = await bx24OAuth(memberId, 'task.elapseditem.getlist', { TASKID: taskId });
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

export async function getWorkloadTime(memberId: string, start: string) {
  const db = await getDb();
  return db.collection('workload_time_aggregate').findOne({ member_id: memberId, start });
}

export async function refreshWorkloadTime(memberId: string, start: string, end: string) {
  const db = await getDb();
  const aggregate = await getWorkloadTime(memberId, start);
  const since = aggregate?.updated_at instanceof Date ? aggregate.updated_at : null;
  await db
    .collection('workload_time_status')
    .updateOne(
      { member_id: memberId, start },
      { $set: { refreshing: true, started_at: new Date() } },
      { upsert: true },
    );

  try {
    const [mirrored, recent] = await Promise.all([
      db.collection('task_mirror').find({ member_id: memberId }).toArray(),
      db.collection('tasks').find({ member_id: memberId }).toArray(),
    ]);
    const tasks = new Map<string, any>();
    for (const item of mirrored) tasks.set(String(item.id), item);
    for (const item of recent) tasks.set(String(item.id), item);
    const candidates = [...tasks.values()].filter(
      (task) => !since || new Date(task.updated_at) > since,
    );

    for (let index = 0; index < candidates.length; index += MAX_CONCURRENT_REQUESTS) {
      await Promise.all(
        candidates.slice(index, index + MAX_CONCURRENT_REQUESTS).map(async (task) => {
          const taskId = String(task.id);
          const entries = await taskEntries(memberId, taskId, start, end);
          await db
            .collection('workload_time_task')
            .updateOne(
              { member_id: memberId, start, task_id: taskId },
              { $set: { entries, updated_at: new Date() } },
              { upsert: true },
            );
        }),
      );
    }

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

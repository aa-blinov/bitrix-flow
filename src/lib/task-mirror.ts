import { getDb } from '@/lib/mongo';
import { bx24OAuth } from '@/lib/oauth-client';
import { randomUUID } from 'node:crypto';

function taskId(task: any) {
  return String(task?.id || task?.ID || '');
}

function projectId(task: any) {
  return String(task?.group?.id || task?.groupId || task?.group_id || task?.GROUP_ID || '0');
}

function parentId(task: any) {
  return String(task?.parentId || task?.parent_id || task?.PARENT_ID || '');
}

export async function syncTaskMirror(memberId: string, id: string, event: string) {
  if (!id) return;
  const db = await getDb();
  const mirror = db.collection('task_mirror');
  if (event === 'ONTASKDELETE') {
    await mirror.deleteOne({ member_id: memberId, id });
    return;
  }
  const response = await bx24OAuth(memberId, 'tasks.task.get', { taskId: id });
  const task = response?.task || response;
  const resolvedId = taskId(task);
  if (!resolvedId) return;
  await mirror.updateOne(
    { member_id: memberId, id: resolvedId },
    {
      $set: {
        member_id: memberId,
        id: resolvedId,
        project_id: projectId(task),
        parent_id: parentId(task),
        data: task,
        synced_at: new Date(),
      },
    },
    { upsert: true },
  );
}

// Reuses the verified complete paginated summary snapshot for the initial mirror.
export async function seedTaskMirror(memberId: string) {
  const db = await getDb();
  const mirror = db.collection('task_mirror');
  if (await mirror.countDocuments({ member_id: memberId }, { limit: 1 })) return;
  const snapshot = await db
    .collection('project_summary_snapshots')
    .findOne({ member_id: memberId });
  const tasks = snapshot?.source?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return;
  await mirror.bulkWrite(
    tasks.map((task: any) => ({
      updateOne: {
        filter: { member_id: memberId, id: taskId(task) },
        update: {
          $set: {
            member_id: memberId,
            id: taskId(task),
            project_id: projectId(task),
            parent_id: parentId(task),
            data: task,
            synced_at: new Date(),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function enqueueTaskMirrorSync(memberId: string, id: string, event: string) {
  if (!id) return;
  const db = await getDb();
  await db.collection('task_sync_jobs').insertOne({
    member_id: memberId,
    task_id: id,
    event,
    status: 'pending',
    attempts: 0,
    next_run_at: new Date(),
    created_at: new Date(),
  });
}

export async function processTaskMirrorJobs(memberId?: string, limit = 10) {
  const db = await getDb();
  const jobs = db.collection('task_sync_jobs');
  for (let processed = 0; processed < limit; processed += 1) {
    const now = new Date();
    const lock = randomUUID();
    const claim: any = await jobs.findOneAndUpdate(
      {
        ...(memberId ? { member_id: memberId } : {}),
        $or: [
          { status: 'pending', next_run_at: { $lte: now } },
          { status: 'processing', locked_until: { $lte: now } },
        ],
      },
      {
        $set: {
          status: 'processing',
          lock,
          locked_until: new Date(Date.now() + 60_000),
          started_at: now,
        },
      },
      { sort: { created_at: 1 }, returnDocument: 'after' },
    );
    const job = claim?.value ?? claim;
    if (!job?._id) break;
    try {
      await seedTaskMirror(job.member_id);
      await syncTaskMirror(job.member_id, job.task_id, job.event);
      await jobs.updateOne(
        { _id: job._id, lock },
        {
          $set: { status: 'done', completed_at: new Date() },
          $unset: { lock: '', locked_until: '' },
        },
      );
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const retryable = attempts < 8;
      await jobs.updateOne(
        { _id: job._id, lock },
        {
          $set: retryable
            ? {
                status: 'pending',
                attempts,
                next_run_at: new Date(Date.now() + Math.min(300_000, 1_000 * 2 ** attempts)),
                last_error: String(error),
              }
            : { status: 'failed', attempts, failed_at: new Date(), last_error: String(error) },
          $unset: { lock: '', locked_until: '' },
        },
      );
    }
  }
}

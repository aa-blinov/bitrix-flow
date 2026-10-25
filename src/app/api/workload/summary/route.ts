// Счётчики календаря нагрузки. Считаем на сервере по всему task_mirror теми же
// полями, что и /api/tasks/all: раньше страница считала ячейки по первой
// странице списка (50 задач), поэтому число в ячейке не совпадало с числом
// задач, которое открывалось по клику.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { taskMirrorStages, timezoneOffsetString } from '@/lib/task-mirror-query';
import { bucketize, type WorkloadTask } from '@/lib/workload';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const start = req.nextUrl.searchParams.get('start') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return NextResponse.json({ error: 'INVALID_START' }, { status: 400 });
  }
  const projectId = req.nextUrl.searchParams.get('projectId') || 'all';

  const weekStart = new Date(`${start}T00:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const timezone = timezoneOffsetString(weekStart);

  const openTask: Record<string, unknown> = { rawStatus: { $ne: '5' } };
  if (projectId !== 'all') openTask.groupId = projectId;

  const { db, stages } = await taskMirrorStages(memberId);
  const result = await db
    .collection('task_mirror')
    .aggregate([
      ...stages,
      { $match: openTask },
      {
        $set: {
          assignee: {
            $cond: [{ $in: ['$responsibleId', ['', '0', null]] }, 'unassigned', '$responsibleId'],
          },
          day: {
            $cond: [
              { $eq: ['$deadlineDate', null] },
              null,
              {
                $dateToString: {
                  date: '$deadlineDate',
                  format: '%Y-%m-%d',
                  timezone,
                },
              },
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: '$taskId',
          parent: { $convert: { input: '$parent', to: 'string', onError: '', onNull: '' } },
          seconds: { $convert: { input: '$estimate', to: 'double', onError: 0, onNull: 0 } },
          assignee: 1,
          day: 1,
          deadline: '$deadlineDate',
        },
      },
    ])
    .toArray();

  // Часы считаем в коде, а не в базе: оценку родителя нужно отбросить, если под ним есть
  // оценённые подзадачи, а это обход дерева (см. src/lib/workload.ts).
  return NextResponse.json(
    bucketize(
      (result as unknown as WorkloadTask[]).map((row) => ({
        ...row,
        deadline: row.deadline ? new Date(row.deadline) : null,
      })),
      { weekStart, weekEnd, today },
    ),
  );
}

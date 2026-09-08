// Счётчики календаря нагрузки. Считаем на сервере по всему task_mirror теми же
// полями, что и /api/tasks/all: раньше страница считала ячейки по первой
// странице списка (50 задач), поэтому число в ячейке не совпадало с числом
// задач, которое открывалось по клику.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { taskMirrorStages, timezoneOffsetString } from '@/lib/task-mirror-query';

export const dynamic = 'force-dynamic';

type Bucket = { userId: string; count: number; hours: number };
type DayBucket = Bucket & { day: string };

function hoursOf(seconds: unknown) {
  return Math.round(((Number(seconds) || 0) / 3600) * 100) / 100;
}

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

  const group = (id: Record<string, unknown>) => [
    {
      $group: {
        _id: id,
        count: { $sum: 1 },
        seconds: {
          $sum: { $convert: { input: '$estimate', to: 'double', onError: 0, onNull: 0 } },
        },
      },
    },
  ];

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
        $facet: {
          days: [
            { $match: { deadlineDate: { $gte: weekStart, $lt: weekEnd } } },
            ...group({ userId: '$assignee', day: '$day' }),
          ],
          noDeadline: [{ $match: { day: null } }, ...group({ userId: '$assignee' })],
          overdue: [
            { $match: { deadlineDate: { $ne: null, $lt: today } } },
            ...group({ userId: '$assignee' }),
          ],
        },
      },
    ])
    .next();

  const toBucket = (row: any): Bucket => ({
    userId: String(row._id.userId),
    count: row.count,
    hours: hoursOf(row.seconds),
  });

  return NextResponse.json({
    days: (result?.days || []).map((row: any): DayBucket => ({
      ...toBucket(row),
      day: row._id.day,
    })),
    noDeadline: (result?.noDeadline || []).map(toBucket),
    overdue: (result?.overdue || []).map(toBucket),
  });
}

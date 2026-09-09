// Счётчики шапки проекта. Раньше ради них выбирались все задачи проекта из
// Битрикса параллельно с колонками доски — вторая загрузка тех же данных.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { taskMirrorStages } from '@/lib/task-mirror-query';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get('projectId') || 'all';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { db, stages } = await taskMirrorStages(memberId);
  const row = await db
    .collection('task_mirror')
    .aggregate([
      ...stages,
      ...(projectId === 'all' ? [] : [{ $match: { groupId: projectId } }]),
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ['$rawStatus', '5'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$rawStatus', '5'] },
                    { $ne: ['$deadlineDate', null] },
                    { $lt: ['$deadlineDate', today] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          unassigned: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$rawStatus', '5'] },
                    { $in: ['$responsibleId', ['', '0', null]] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          estimateSeconds: {
            $sum: { $convert: { input: '$estimate', to: 'double', onError: 0, onNull: 0 } },
          },
          actualSeconds: {
            $sum: { $convert: { input: '$actual', to: 'double', onError: 0, onNull: 0 } },
          },
        },
      },
    ])
    .next();

  const hours = (seconds: unknown) => Math.round(((Number(seconds) || 0) / 3600) * 100) / 100;
  return NextResponse.json({
    total: row?.total || 0,
    done: row?.done || 0,
    overdue: row?.overdue || 0,
    unassigned: row?.unassigned || 0,
    estimateHours: hours(row?.estimateSeconds),
    actualHours: hours(row?.actualSeconds),
  });
}

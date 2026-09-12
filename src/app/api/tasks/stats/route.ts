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
  // Разрез по всем проектам сразу — для карточек главной. Раньше она считала их
  // по первым 50 задачам, поэтому у «БСПБ | Баги» стояло 21 вместо 58.
  const byProject = req.nextUrl.searchParams.get('byProject') === 'true';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Те же границы, что у клиентских needsDeadlineAttention/isDueThisWeek:
  // «внимание» — срок не позже завтра, «на неделе» — в ближайшие семь дней.
  const afterTomorrow = new Date(today);
  afterTomorrow.setDate(afterTomorrow.getDate() + 2);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 8);

  const { db, stages } = await taskMirrorStages(memberId);

  if (byProject) {
    const active = { $ne: ['$rawStatus', '5'] };
    const hasDeadline = { $ne: ['$deadlineDate', null] };
    const page = await db
      .collection('task_mirror')
      .aggregate([
        ...stages,
        {
          $facet: {
            projects: [
              {
                $group: {
                  _id: '$groupId',
                  total: { $sum: 1 },
                  done: { $sum: { $cond: [{ $eq: ['$rawStatus', '5'] }, 1, 0] } },
                  overdue: {
                    $sum: {
                      $cond: [
                        {
                          $and: [active, hasDeadline, { $lt: ['$deadlineDate', today] }],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  attention: {
                    $sum: {
                      $cond: [
                        { $and: [active, hasDeadline, { $lt: ['$deadlineDate', afterTomorrow] }] },
                        1,
                        0,
                      ],
                    },
                  },
                  inProgress: { $sum: { $cond: [{ $eq: ['$rawStatus', '3'] }, 1, 0] } },
                  week: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            active,
                            hasDeadline,
                            { $gte: ['$deadlineDate', today] },
                            { $lt: ['$deadlineDate', weekEnd] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  noDeadline: {
                    $sum: { $cond: [{ $and: [active, { $eq: ['$deadlineDate', null] }] }, 1, 0] },
                  },
                },
              },
            ],
          },
        },
      ])
      .next();
    const totals = page?.totals?.[0] || {};
    return NextResponse.json({
      projects: (page?.projects || []).map((item: Record<string, unknown>) => ({
        id: String(item._id ?? '0'),
        total: item.total || 0,
        done: item.done || 0,
        overdue: item.overdue || 0,
      })),
      totals: {
        attention: totals.attention || 0,
        inProgress: totals.inProgress || 0,
        week: totals.week || 0,
        noDeadline: totals.noDeadline || 0,
      },
    });
  }

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

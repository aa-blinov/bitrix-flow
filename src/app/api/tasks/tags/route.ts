// Список #тегов, встречающихся в задачах. Теги не отдельное поле Битрикса, а
// хэштеги в названии и описании, поэтому собираем их агрегацией по зеркалу —
// иначе фильтр в списке знал бы только теги загруженной страницы.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { taskMirrorStages } from '@/lib/task-mirror-query';
import { MONGO_HASHTAG_REGEX } from '@/lib/task-tags';

export const dynamic = 'force-dynamic';

const MAX_TAGS = 200;

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get('projectId') || 'all';
  const match: Record<string, unknown> = {};
  if (projectId !== 'all') match.groupId = projectId;

  const { db, stages } = await taskMirrorStages(memberId);
  const rows = await db
    .collection('task_mirror')
    .aggregate(
      [
        ...stages,
        ...(Object.keys(match).length ? [{ $match: match }] : []),
        {
          $set: {
            // Ведущий пробел заменяет ^ в разборе: тег может стоять первым словом.
            text: {
              $concat: [' ', { $ifNull: ['$title', ''] }, ' ', { $ifNull: ['$description', ''] }],
            },
          },
        },
        { $set: { hits: { $regexFindAll: { input: '$text', regex: MONGO_HASHTAG_REGEX } } } },
        {
          $set: {
            // Штатный тег Битрикса и #хэштег из текста для пользователя — одно
            // и то же понятие, поэтому список общий.
            allTags: {
              $concatArrays: [
                { $ifNull: ['$bitrixTags', []] },
                {
                  $map: {
                    input: { $ifNull: ['$hits', []] },
                    as: 'hit',
                    in: { $arrayElemAt: ['$$hit.captures', 0] },
                  },
                },
              ],
            },
          },
        },
        { $unwind: '$allTags' },
        { $match: { allTags: { $nin: [null, ''] } } },
        // Одинаковые теги в разном регистре — один тег. Группируем с коллацией
        // (strength 2), потому что $toLower не приводит кириллицу.
        { $group: { _id: '$allTags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: MAX_TAGS },
      ],
      { collation: { locale: 'ru', strength: 2 } },
    )
    .toArray();

  return NextResponse.json({
    tags: rows.map((row) => ({ tag: String(row._id), label: String(row._id), count: row.count })),
  });
}

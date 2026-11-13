// Класс часов по умолчанию для проекта. Хранится в портале, тегом часы-* в ключевых
// словах группы, как и класс задачи: своей разметки у приложения нет. Копия в projects
// обновляется тут же, иначе аналитика увидела бы класс только после прогрева /api/dashboard.
import { NextRequest, NextResponse, after } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { HOUR_CLASSES, projectHourClass, withProjectClass, type HourClass } from '@/lib/hour-class';
import { isMockEnabled } from '@/lib/mock-b24';
import { getDb } from '@/lib/mongo';
import { applyClassTags, planProjectClassTags } from '@/lib/project-class-tags';
import { bx24OAuth } from '@/lib/oauth-client';
import { invalidateByPrefix } from '@/lib/server-cache';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId || '');
  const hourClass = body.hourClass ? (String(body.hourClass) as HourClass) : null;
  if (!/^[1-9]\d*$/.test(projectId) || (hourClass && !HOUR_CLASSES.includes(hourClass))) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  // dryRun показывает, какие задачи получат тег, ничего не записывая.
  const dryRun = body.dryRun === true;
  const db = await getDb();
  let keywords: string;
  try {
    let current: unknown;
    if (isMockEnabled()) {
      current = (await db.collection('projects').findOne({ member_id: memberId, id: projectId }))
        ?.keywords;
    } else {
      // Ключевые слова перечитываем из портала: копия в базе могла отстать, а
      // sonet_group.update переписывает их целиком и стёр бы чужие слова.
      const [group] = (await bx24OAuth(memberId, 'sonet_group.get', {
        'FILTER[ID]': projectId,
      })) as { KEYWORDS?: string }[];
      if (!group) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      current = group.KEYWORDS;
    }
    const previous = projectHourClass(current);
    keywords = withProjectClass(current, hourClass);
    // Снятый класс проекта теги задач не трогает: разметка остаётся как была.
    const changes = hourClass
      ? await planProjectClassTags(memberId, projectId, hourClass, previous)
      : [];
    if (dryRun) return NextResponse.json({ previous, hourClass, changes });
    if (!isMockEnabled())
      await bx24OAuth(memberId, 'sonet_group.update', { GROUP_ID: projectId, KEYWORDS: keywords });
    // Задач бывают сотни, а на каждую два запроса к порталу: ответ не ждёт раскладки.
    if (hourClass && changes.length)
      after(async () => {
        const result = await applyClassTags(memberId, changes, hourClass, previous);
        invalidateByPrefix(`${memberId}:`);
        console.log('[project-class]', projectId, hourClass, result.done, 'тегов', result.failed);
      });
  } catch (error) {
    return NextResponse.json(
      { error: 'BITRIX_ERROR', message: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }

  await db
    .collection('projects')
    .updateOne({ member_id: memberId, id: projectId }, { $set: { keywords } });
  invalidateByPrefix(`${memberId}:`);
  return NextResponse.json({ keywords });
}

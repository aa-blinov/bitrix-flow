// Класс часов по умолчанию для проекта. Хранится в портале, тегом часы-* в ключевых
// словах группы, как и класс задачи: своей разметки у приложения нет. Копия в projects
// обновляется тут же, иначе аналитика увидела бы класс только после прогрева /api/dashboard.
import { NextRequest, NextResponse, after } from 'next/server';
import { getAuthorizedPerson } from '@/lib/authorized-member';
import { HOUR_CLASSES, projectHourClass, withProjectClass, type HourClass } from '@/lib/hour-class';
import { isMockEnabled } from '@/lib/mock-b24';
import { getDb } from '@/lib/mongo';
import { applyClassTags, planProjectClassTags } from '@/lib/project-class-tags';
import { bx24OAuth } from '@/lib/oauth-client';
import { invalidateByPrefix } from '@/lib/server-cache';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const person = await getAuthorizedPerson(req.cookies.get(sessionCookie.name)?.value);
  if (!person) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const { memberId } = person;
  // Класс проекта меняет сам человек, и портал проверяет его права на группу. Раскладка
  // тегов по задачам после этого идёт фоном токеном портала, как тегирование новых задач.
  const as = { asUser: person.userId };

  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId || '');
  const hourClass = body.hourClass ? (String(body.hourClass) as HourClass) : null;
  if (!/^[1-9]\d*$/.test(projectId) || (hourClass && !HOUR_CLASSES.includes(hourClass))) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  // dryRun показывает, какие задачи получат тег, ничего не записывая.
  const dryRun = body.dryRun === true;
  const db = await getDb();
  // Класс до смены нужен и после try: от него зависит, с какого момента начнёт
  // действовать новый период (первый класс и_replace замены живут с разных дат).
  let previous: HourClass | null = null;
  let keywords: string;
  try {
    let current: unknown;
    if (isMockEnabled()) {
      current = (await db.collection('projects').findOne({ member_id: memberId, id: projectId }))
        ?.keywords;
    } else {
      // Ключевые слова перечитываем из портала: копия в базе могла отстать, а
      // sonet_group.update переписывает их целиком и стёр бы чужие слова.
      const [group] = (await bx24OAuth(
        memberId,
        'sonet_group.get',
        { 'FILTER[ID]': projectId },
        as,
      )) as { KEYWORDS?: string }[];
      if (!group) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      current = group.KEYWORDS;
    }
    previous = projectHourClass(current);
    keywords = withProjectClass(current, hourClass);
    // По умолчанию смена действует с сегодняшнего дня и историю не трогает: классы
    // старых задач считаются по периодам. Переразметка задним числом — только по
    // явному backfill (dryRun показывает план, apply пишет теги в портал).
    const changes =
      body.backfill === true && hourClass
        ? await planProjectClassTags(memberId, projectId, hourClass, previous)
        : [];
    if (dryRun) return NextResponse.json({ previous, hourClass, changes });
    if (!isMockEnabled())
      await bx24OAuth(
        memberId,
        'sonet_group.update',
        { GROUP_ID: projectId, KEYWORDS: keywords },
        as,
      );
    // Задач бывают сотни, а на каждую два запроса к порталу: ответ не ждёт раскладки.
    if (hourClass && changes.length)
      after(async () => {
        const result = await applyClassTags(memberId, changes, hourClass, previous, person.userId);
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
  // Смена класса не перезаписывает, а добавляет период: резолвинг задач идёт по дате
  // создания задачи, уборка или смена тоже должна обрубить старый класс с этой минуты.
  // Первый класс проекта — не смена: он действует и на существующие задачи, поэтому
  // начинается «с начала времён», иначе назначение класса не дало бы видимого эффекта.
  const hasPeriods =
    (await db.collection('project_class_periods').countDocuments({
      member_id: memberId,
      projectId,
    })) > 0;
  const periods = db.collection('project_class_periods');
  if (hasPeriods) {
    await periods.insertOne({
      member_id: memberId,
      projectId,
      hourClass,
      since: new Date().toISOString(),
    });
  } else if (previous && previous !== hourClass) {
    // Первый период пишем, а в ключевых словах уже стоял другой класс: значит смена
    // всё-таки есть — старый класс действует с начала времён, новый с этой минуты.
    await periods.insertOne({ member_id: memberId, projectId, hourClass: previous, since: '' });
    await periods.insertOne({
      member_id: memberId,
      projectId,
      hourClass,
      since: new Date().toISOString(),
    });
  } else {
    // Первый класс проекта — не смена: он действует и на существующие задачи,
    // поэтому начинается «с начала времён», иначе назначение не дало бы эффекта.
    await periods.insertOne({ member_id: memberId, projectId, hourClass, since: '' });
  }
  invalidateByPrefix(`${memberId}:`);
  return NextResponse.json({ keywords });
}

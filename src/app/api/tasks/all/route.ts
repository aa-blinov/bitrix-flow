// Batched server-side fetch of tasks across all member's projects.
// На холодном старте: читает MongoDB → для проектов без кэша параллельно
// фетчит из Битрикса → пишет обратно → возвращает. На прогретом кэше —
// моментальный read без обращения к Битриксу.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { getDb } from '@/lib/mongo';
import { postBitrixJson } from '@/lib/bitrix-request';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) {
    return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  }
  // Если для авторизованного member_id нет ни Bitrix-токена, ни синхронизированных
  // задач — это инвалидированное состояние. Очищаем его и отдаём пустой список,
  // чтобы клиент не видел залежавшиеся данные из старого token.
  const db0 = await getDb();
  const token = await db0
    .collection('user_tokens')
    .findOne({ member_id: memberId }, { projection: { _id: 1, domain: 1, access_token: 1 } });
  if (!token?.access_token || !token.domain) {
    await db0.collection('task_mirror').deleteMany({ member_id: memberId });
    await db0.collection('projects').deleteMany({ member_id: memberId });
    await db0.collection('tasks').deleteMany({ member_id: memberId });
    return NextResponse.json({ tasks: [] });
  }

  const db = await getDb();

  // task_mirror — полный серверный снимок задач, обновляемый событиями Bitrix24.
  // Не ходим в Bitrix24 из HTTP-ответа: один отсутствующий проект раньше
  // превращал открытие «Все задачи» в десятки запросов и HTTP 500.
  const [mirrored, recent] = await Promise.all([
    db.collection('task_mirror').find({ member_id: memberId }).toArray(),
    db.collection('tasks').find({ member_id: memberId }).toArray(),
  ]);
  const byId = new Map<string, any>();
  for (const task of mirrored) byId.set(String(task.id), task.data);
  // `tasks` содержит свежие записи, полученные background-sync, и перекрывает
  // соответствующие документы из полного снимка.
  for (const task of recent) byId.set(String(task.id), task.data);

  if (byId.size === 0) {
    const allTasks: any[] = [];
    let start = 0;
    const visited = new Set<number>();
    while (!visited.has(start)) {
      visited.add(start);
      const response = await postBitrixJson(
        `https://${token.domain}/rest/tasks.task.list?auth=${token.access_token}`,
        { order: { ID: 'DESC' }, start },
        true,
      );
      if (response.error) throw new Error(`${response.error}: ${response.error_description}`);
      const tasks = response.result?.tasks || [];
      allTasks.push(...tasks);
      if (response.next === undefined || response.next === null) break;
      start = Number(response.next);
    }
    if (allTasks.length) {
      await db.collection('task_mirror').bulkWrite(
        allTasks.map((task) => ({
          updateOne: {
            filter: { member_id: memberId, id: String(task.id) },
            update: {
              $set: {
                member_id: memberId,
                id: String(task.id),
                data: task,
                updated_at: new Date(),
              },
            },
            upsert: true,
          },
        })),
      );
    }
    return NextResponse.json({ tasks: allTasks });
  }

  return NextResponse.json({ tasks: Array.from(byId.values()) });
}

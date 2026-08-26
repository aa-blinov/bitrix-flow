// Batched server-side fetch of tasks across all member's projects.
// На холодном старте: читает MongoDB → для проектов без кэша параллельно
// фетчит из Битрикса → пишет обратно → возвращает. На прогретом кэше —
// моментальный read без обращения к Битриксу.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { getDb } from '@/lib/mongo';
import { bx24OAuth } from '@/lib/oauth-client';

const PAGE_SIZE = 50;

export const dynamic = 'force-dynamic';

async function fetchAllForProject(
  memberId: string,
  projectId: string,
): Promise<any[]> {
  const all: any[] = [];
  let start = 0;
  for (let page = 0; page < 20; page += 1) {
    const data = await bx24OAuth(memberId, 'tasks.task.list', {
      'filter[GROUP_ID]': projectId,
      start: String(start),
    });
    const batch = data?.result?.tasks || data?.tasks || [];
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return all;
}

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) {
    return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  }

  const db = await getDb();
  const projects = await db.collection('projects').find({}).toArray();

  // 1. Достаём всё что уже в MongoDB одним запросом.
  const cached = await db.collection('tasks').find({}).toArray();
  const byProject = new Map<string, any[]>();
  for (const doc of cached) {
    const arr = byProject.get(doc.groupId) || [];
    arr.push(doc.data);
    byProject.set(doc.groupId, arr);
  }

  // 2. Для проектов без кэша — параллельно тянем из Битрикса (сервер-сайд,
  // ограничения браузера на 6 коннектов тут не действуют).
  const missing = projects.filter((p) => !byProject.has(p.id as string));
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (p) => {
        const tasks = await fetchAllForProject(memberId, p.id as string);
        if (tasks.length > 0) {
          await db.collection('tasks').bulkWrite(
            tasks.map((t: any) => {
              const id = String(t.id ?? t.ID);
              return {
                updateOne: {
                  filter: { groupId: p.id, id },
                  update: {
                    $set: { groupId: p.id, id, data: t, updated_at: new Date() },
                  },
                  upsert: true,
                },
              };
            }),
            { ordered: false },
          );
          byProject.set(p.id as string, tasks);
        } else {
          byProject.set(p.id as string, []);
        }
      }),
    );
  }

  // 3. SSE-уведомление для других подключённых клиентов: «задачи обновились».
  await db.collection('events_stream').insertOne({
    member_id: memberId,
    event: {
      type: 'tasks-changed',
      source: '/api/tasks/all',
      at: new Date().toISOString(),
    },
    created_at: new Date(),
  });

  const all = Array.from(byProject.values()).flat();
  return NextResponse.json({ tasks: all });
}

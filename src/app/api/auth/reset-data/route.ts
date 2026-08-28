import { NextRequest, NextResponse } from 'next/server';
import { sessionCookie } from '@/lib/session';
import { revokeStoredSession } from '@/lib/session-store';
import { getDb } from '@/lib/mongo';

// Полностью стирает данные портала в Mongo: проекты, задачи, кэш и т. д.
// Куку сессии тоже отзываем. Используется, когда нужно сбросить состояние
// после ручной чистки user_tokens.
export async function POST(req: NextRequest) {
  const db = await getDb();
  const collections = [
    'tasks',
    'time_entries',
    'comments',
    'stages',
    'task_views',
    'events_stream',
    'project_summary_snapshots',
    'task_mirror',
    'notifications',
    'cache',
    'projects',
    'task_sync_jobs',
    'user_tokens',
  ];
  for (const name of collections) {
    try {
      await db.collection(name).deleteMany({});
    } catch {}
  }
  await revokeStoredSession(req.cookies.get(sessionCookie.name)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ ...sessionCookie, value: '', maxAge: 0, path: '/' });
  return response;
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { getDb } from '@/lib/mongo';
import { sessionCookie } from '@/lib/session';
import { getWorkloadTime, refreshStatus, refreshWorkloadTime } from '@/lib/workload-time';

function validDay(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

async function memberId(request: NextRequest) {
  return getAuthorizedMemberId(request.cookies.get(sessionCookie.name)?.value);
}

export async function GET(request: NextRequest) {
  const member = await memberId(request);
  const start = request.nextUrl.searchParams.get('start');
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  if (!validDay(start)) return NextResponse.json({ error: 'INVALID_START' }, { status: 400 });
  const [aggregate, status] = await Promise.all([
    getWorkloadTime(member, start!),
    refreshStatus(member, [start!]),
  ]);
  // Названия берём из зеркала: у клиента в списке нет закрытых и старых задач, а строка
  // «Задача #123» в окне списаний ничего не говорит.
  const ids = [...new Set((aggregate?.details || []).map((entry: any) => String(entry.taskId)))];
  const titles: Record<string, string> = {};
  if (ids.length) {
    const db = await getDb();
    const mirrored = await db
      .collection('task_mirror')
      .find({ member_id: member, id: { $in: ids } }, { projection: { id: 1, data: 1 } })
      .toArray();
    for (const task of mirrored) {
      const title = task.data?.title ?? task.data?.TITLE;
      if (title) titles[String(task.id)] = String(title);
    }
  }
  return NextResponse.json(
    { data: aggregate || null, titles, refreshing: status.refreshing },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const member = await memberId(request);
  const body = await request.json().catch(() => null);
  const start = typeof body?.start === 'string' ? body.start : null;
  const end = typeof body?.end === 'string' ? body.end : null;
  if (!member) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  if (!validDay(start) || !validDay(end))
    return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  void refreshWorkloadTime(member, start!, end!).catch((error) =>
    console.error('[workload-time]', error),
  );
  return NextResponse.json({ started: true }, { status: 202 });
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function getMemberId(req: NextRequest) {
  return getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
}

// Лента постранично, как списки задач: page + limit, в ответе total.
export async function GET(req: NextRequest) {
  const memberId = await getMemberId(req);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 400 });
  const db = await getDb();
  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);
  const page = Math.max(Math.floor(Number(params.get('page')) || 1), 1);
  const filter: Record<string, unknown> = { member_id: memberId };
  // Фильтры ленты: проект и тип события. Значения — строки из UI, в запрос
  // идут как есть, без операторов.
  const projectId = params.get('projectId');
  if (projectId && /^\d+$/.test(projectId)) filter.projectId = projectId;
  const type = params.get('type');
  if (type && /^[a-z_]+$/.test(type)) filter.type = type;
  const collection = db.collection('notifications');
  const [rows, total] = await Promise.all([
    collection
      .find(filter, { projection: { raw_event: 0 } })
      .sort({ created_at: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);
  return NextResponse.json(
    {
      notifications: rows.map(({ _id, member_id, ...item }) => ({
        id: _id.toString(),
        ...item,
      })),
      total,
    },
    { headers: { 'Cache-Control': 'private, max-age=10' } },
  );
}

export async function DELETE(req: NextRequest) {
  const memberId = await getMemberId(req);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 400 });
  const result = await (
    await getDb()
  )
    .collection('notifications')
    .deleteMany({ member_id: memberId });
  return NextResponse.json({ deleted: result.deletedCount });
}

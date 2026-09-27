import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function getMemberId(req: NextRequest) {
  return getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
}

// Лента отдаётся кусками по курсору (created_at + _id), а не offset: новые
// уведомления приходят сверху, и offset сдвигал бы следующую страницу.
export async function GET(req: NextRequest) {
  const memberId = await getMemberId(req);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 400 });
  const db = await getDb();
  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);
  const filter: Record<string, unknown> = { member_id: memberId };
  const cursor = parseCursor(params.get('before'));
  if (cursor) {
    filter.$or = [
      { created_at: { $lt: cursor.createdAt } },
      { created_at: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }
  // На одну больше, чтобы без отдельного count понять, есть ли продолжение.
  const rows = await db
    .collection('notifications')
    .find(filter, { projection: { raw_event: 0 } })
    .sort({ created_at: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last?.created_at
      ? `${new Date(last.created_at).toISOString()}_${last._id.toString()}`
      : null;
  return NextResponse.json(
    {
      notifications: page.map(({ _id, member_id, ...item }) => ({
        id: _id.toString(),
        ...item,
      })),
      nextCursor,
    },
    { headers: { 'Cache-Control': 'private, max-age=10' } },
  );
}

function parseCursor(raw: string | null): { createdAt: Date; id: ObjectId } | null {
  if (!raw) return null;
  const [iso, id] = raw.split('_');
  const createdAt = new Date(iso || '');
  if (Number.isNaN(createdAt.getTime()) || !id || !ObjectId.isValid(id)) return null;
  return { createdAt, id: new ObjectId(id) };
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

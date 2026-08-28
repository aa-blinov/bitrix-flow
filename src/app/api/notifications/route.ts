import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function getMemberId(req: NextRequest) {
  return getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
}

export async function GET(req: NextRequest) {
  const memberId = await getMemberId(req);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 400 });
  const db = await getDb();
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit')) || 50;
  const notifications = await db
    .collection('notifications')
    .find({ member_id: memberId })
    .sort({ created_at: -1 })
    .limit(Math.min(Math.max(requestedLimit, 1), 200))
    .toArray();
  return NextResponse.json({
    notifications: notifications.map(({ _id, member_id, ...item }) => ({
      id: _id.toString(),
      ...item,
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const memberId = await getMemberId(req);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 400 });
  const result = await (await getDb()).collection('notifications').deleteMany({ member_id: memberId });
  return NextResponse.json({ deleted: result.deletedCount });
}

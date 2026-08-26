import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 400 });
  const db = await getDb();
  const notifications = await db
    .collection('notifications')
    .find({ member_id: memberId })
    .sort({ created_at: -1 })
    .limit(50)
    .toArray();
  return NextResponse.json({
    notifications: notifications.map(({ _id, member_id, ...item }) => ({
      id: _id.toString(),
      ...item,
    })),
  });
}

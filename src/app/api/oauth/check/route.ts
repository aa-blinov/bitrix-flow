import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

// Проверка статуса OAuth подключения
export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);

  if (!memberId) {
    return NextResponse.json({ connected: false });
  }

  try {
    const db = await getDb();
    const token = await db.collection('user_tokens').findOne({ member_id: memberId });

    if (!token) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      member_id: memberId,
      domain: token.domain,
      scope: token.scope,
      installed_at: token.installed_at,
    });
  } catch (err: any) {
    return NextResponse.json({ connected: false, error: err.message });
  }
}

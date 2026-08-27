import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { isMockEnabled } from '@/lib/mock-b24';

// Проверка статуса OAuth подключения
export async function GET(req: NextRequest) {
  if (isMockEnabled()) {
    return NextResponse.json({ connected: true, member_id: 'mock-member' });
  }

  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);

  if (!memberId) {
    return NextResponse.json({ connected: false, session: false, error: 'NOT_AUTHENTICATED' });
  }

  try {
    const db = await getDb();
    const token = await db.collection('user_tokens').findOne({ member_id: memberId });

    if (!token) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
    session: true,
      member_id: memberId,
      domain: token.domain,
      scope: token.scope,
      installed_at: token.installed_at,
    });
  } catch (err: any) {
    return NextResponse.json({ connected: false, session: true, error: err.message });
  }
}

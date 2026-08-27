import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { getSessionId, sessionCookie } from '@/lib/session';
import { isMockEnabled } from '@/lib/mock-b24';

// Проверка статуса OAuth подключения
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (isMockEnabled()) {
    return NextResponse.json({ connected: true, member_id: 'mock-member' });
  }

  const cookie = req.cookies.get(sessionCookie.name)?.value;
  const sessionId = await getSessionId(cookie);
  const sessionActive = !!sessionId;

  if (!sessionActive) {
    return NextResponse.json({ connected: false, session: false, error: 'NOT_AUTHENTICATED' });
  }

  const memberId = await getAuthorizedMemberId(cookie).catch(() => null);

  try {
    const db = await getDb();
    const query = memberId ? { member_id: memberId } : { access_token: { $type: 'string', $ne: '' } };
    const token = await db.collection('user_tokens').findOne(query, {
      sort: { updated_at: -1, installed_at: -1 },
    });

    if (!token) {
      // Сессия приложения есть, но Bitrix OAuth не установлен.
      return NextResponse.json({ connected: false, session: true });
    }

    return NextResponse.json({
      connected: true,
      session: true,
      member_id: String(token.member_id),
      domain: token.domain,
      scope: token.scope,
      installed_at: token.installed_at,
    });
  } catch (err: any) {
    return NextResponse.json({ connected: false, session: true, error: err.message });
  }
}

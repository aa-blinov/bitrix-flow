import { NextRequest, NextResponse } from 'next/server';
import { sessionCookie } from '@/lib/session';
import { getSessionUser } from '@/lib/session-store';

export const dynamic = 'force-dynamic';

// Кто вошёл: интерфейс по роли решает, показывать ли раздел учётных записей.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req.cookies.get(sessionCookie.name)?.value);
  if (!user) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  return NextResponse.json({ username: user.username, role: user.role });
}

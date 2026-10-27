import { NextRequest, NextResponse } from 'next/server';
import { sessionCookie } from './session';
import { getSessionUser } from './session-store';
import type { AppUser } from './users';

/** Админские роуты: сессия должна принадлежать активному администратору. */
export async function withAdmin(
  req: NextRequest,
  run: (admin: AppUser) => Promise<NextResponse>,
): Promise<NextResponse> {
  const user = await getSessionUser(req.cookies.get(sessionCookie.name)?.value);
  if (!user) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  return run(user);
}

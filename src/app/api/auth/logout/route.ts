import { NextRequest, NextResponse } from 'next/server';
import { sessionCookie } from '@/lib/session';
import { revokeStoredSession } from '@/lib/session-store';

export async function POST(request: NextRequest) {
  await revokeStoredSession(request.cookies.get(sessionCookie.name)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ ...sessionCookie, value: '', maxAge: 0, path: '/' });
  return response;
}

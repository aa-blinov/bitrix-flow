import { NextRequest, NextResponse } from 'next/server';
import { sessionCookie } from '@/lib/session';
import { revokeStoredSession } from '@/lib/session-store';

export async function POST(request: NextRequest) {
  await revokeStoredSession(request.cookies.get(sessionCookie.name)?.value);
  // Обычная форма (экран «Подключите Битрикс») ждёт страницу, а не JSON.
  const fromForm = (request.headers.get('content-type') || '').includes('form');
  const response = fromForm
    ? NextResponse.redirect(new URL('/login', request.url), 303)
    : NextResponse.json({ ok: true });
  response.cookies.set({ ...sessionCookie, value: '', maxAge: 0, path: '/' });
  return response;
}

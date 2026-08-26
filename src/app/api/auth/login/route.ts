import { NextRequest, NextResponse } from 'next/server';
import { createSession, sessionCookie } from '@/lib/session';
import { createStoredSession } from '@/lib/session-store';

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function getAttempt(ip: string) {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < Date.now()) {
    const fresh = { count: 0, resetAt: Date.now() + ATTEMPT_WINDOW_MS };
    attempts.set(ip, fresh);
    return fresh;
  }
  return entry;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const attempt = getAttempt(ip);
  if (attempt.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    username?: unknown;
    password?: unknown;
    next?: unknown;
  } | null;
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const expectedUsername = process.env.AUTH_USERNAME;
  const expectedPassword = process.env.AUTH_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return NextResponse.json({ error: 'AUTH_NOT_CONFIGURED' }, { status: 503 });
  }

  if (username !== expectedUsername || password !== expectedPassword) {
    attempt.count += 1;
    return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
  }

  attempts.delete(ip);
  const session = await createSession();
  await createStoredSession(session, request.headers.get('user-agent'));
  const response = NextResponse.json({ ok: true, next: safeNext(body?.next) });
  response.cookies.set({
    ...sessionCookie,
    value: session,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.BITRIX24_APP_URL?.startsWith('https://') ?? false,
    path: '/',
  });
  return response;
}

function safeNext(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

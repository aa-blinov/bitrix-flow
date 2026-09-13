import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
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
  // X-Forwarded-For клиент подделывает: Caddy лишь дописывает реальный адрес
  // в конец списка. Берём X-Real-IP, который прокси перезаписывает сам, и
  // только как запасной вариант — последний элемент XFF.
  const forwarded = request.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim());
  const ip =
    request.headers.get('x-real-ip')?.trim() || forwarded?.[forwarded.length - 1] || 'unknown';
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

  if (!matches(username, expectedUsername) || !matches(password, expectedPassword)) {
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
    // Кука без Secure уедет и по http: в проде это недопустимо, а в локальной
    // разработке по http её иначе не выставить.
    secure:
      process.env.NODE_ENV === 'production' ||
      (process.env.BITRIX24_APP_URL?.startsWith('https://') ?? false),
    path: '/',
  });
  return response;
}

/** Сравнение за постоянное время: длина пароля не должна утекать по таймингу. */
function matches(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length) {
    // Всё равно тратим сравнение, чтобы ветка не отличалась по времени.
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqual(receivedBytes, expectedBytes);
}

function safeNext(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

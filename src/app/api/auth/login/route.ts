import { NextRequest, NextResponse } from 'next/server';
import { createSession, sessionCookie } from '@/lib/session';
import { createStoredSession } from '@/lib/session-store';
import { verifyPassword } from '@/lib/password';
import { bootstrapAdmin, findUserByName, markLogin, normalizeUsername } from '@/lib/users';

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
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';

  // Подбор идёт и по одному адресу, и по одному логину с разных адресов: лимит на оба.
  const byName = getAttempt(`user:${username}`);
  if (byName.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'TOO_MANY_ATTEMPTS' }, { status: 429 });
  }

  await bootstrapAdmin();
  if (!process.env.AUTH_SESSION_SECRET) {
    return NextResponse.json({ error: 'AUTH_NOT_CONFIGURED' }, { status: 503 });
  }
  const user = username ? await findUserByName(username) : null;
  // Пароль проверяется и для несуществующего логина (см. verifyPassword), чтобы ответ не
  // выдавал, есть ли такая запись.
  const passwordOk = await verifyPassword(password, user?.password_hash);
  if (!user || !passwordOk) {
    attempt.count += 1;
    byName.count += 1;
    return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
  // О блокировке говорим только тому, кто знает пароль: иначе это способ перебирать логины.
  if (user.blocked) return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403 });

  attempts.delete(ip);
  attempts.delete(`user:${username}`);
  await markLogin(user._id);
  const session = await createSession();
  await createStoredSession(session, request.headers.get('user-agent'), String(user._id));
  const response = NextResponse.json({ ok: true, next: safeNext(body?.next) });
  response.cookies.set({
    ...sessionCookie,
    value: session,
    httpOnly: true,
    sameSite: 'lax',
    // Кука без Secure уедет и по http, поэтому в проде она всегда Secure.
    // Исключение — локальный адрес: браузер не примет Secure-куку по http,
    // и UI-тесты на 127.0.0.1 не смогли бы войти.
    secure: isSecureOrigin(),
    path: '/',
  });
  return response;
}

function isSecureOrigin(): boolean {
  const appUrl = process.env.BITRIX24_APP_URL || '';
  if (appUrl.startsWith('https://')) return true;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(appUrl)) return false;
  return process.env.NODE_ENV === 'production';
}

function safeNext(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

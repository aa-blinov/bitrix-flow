import type { NextResponse } from 'next/server';
import { createSession, sessionCookie } from '@/lib/session';
import { createStoredSession } from '@/lib/session-store';

// Общий конец любого входа (пароль или Битрикс): серверная запись сессии и HttpOnly-кука.
export async function startSession(
  response: NextResponse,
  userId: string,
  userAgent: string | null,
) {
  const session = await createSession();
  await createStoredSession(session, userAgent, userId);
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

export function isSecureOrigin(): boolean {
  const appUrl = process.env.BITRIX24_APP_URL || '';
  if (appUrl.startsWith('https://')) return true;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(appUrl)) return false;
  return process.env.NODE_ENV === 'production';
}

// Только путь этого же приложения: «//host» и «/\\host» браузер и URL читают как другой сайт,
// а после входа через Битрикс сервер сам делает редирект по этому значению.
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || /^\/[\\/]/.test(value)) return '/';
  if (/[\\\u0000-\u001f]/.test(value)) return '/';
  try {
    const base = 'https://app.invalid';
    return new URL(value, base).origin === base ? value : '/';
  } catch {
    return '/';
  }
}

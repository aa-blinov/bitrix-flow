import { NextRequest, NextResponse } from 'next/server';
import { bx24OAuth } from '@/lib/oauth-client';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

// Регистрирует обработчик событий в Битрикс24
// Вызывается один раз после OAuth авторизации
export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 401 });
  // Never allow a request to turn the app into an event forwarder to an
  // attacker-controlled URL. The registered target is this application only.
  const handlerUrl = new URL('/api/b24/handler', req.nextUrl.origin).toString();

  const events = ['OnTaskAdd', 'OnTaskUpdate', 'OnTaskDelete', 'OnTaskCommentAdd'];

  const results = [];

  for (const event of events) {
    try {
      const result = await bx24OAuth(memberId, 'event.bind', {
        event,
        handler: handlerUrl,
      });
      results.push({ event, success: true, result });
    } catch (err: any) {
      results.push({ event, success: false, error: err.message });
    }
  }

  return NextResponse.json({ results });
}

// Получить список зарегистрированных обработчиков
export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 401 });

  try {
    const events = await bx24OAuth(memberId, 'event.get', {});
    return NextResponse.json({ events });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

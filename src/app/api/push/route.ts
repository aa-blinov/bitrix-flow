import { NextRequest, NextResponse } from 'next/server';
import { invalidatePushWanted } from '@/lib/messenger-events';
import { getAuthorizedPerson } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { pushConfigured, removeSubscription, saveSubscription, vapidPublicKey } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Подписка принадлежит человеку: пуши о его переписке не уходят на чужие устройства.
const member = (req: NextRequest) =>
  getAuthorizedPerson(req.cookies.get(sessionCookie.name)?.value);

// Публичный ключ нужен браузеру, чтобы оформить подписку.
export async function GET(req: NextRequest) {
  if (!(await member(req)))
    return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: 'PUSH_DISABLED' }, { status: 404 });
  return NextResponse.json({ key: vapidPublicKey() });
}

export async function POST(req: NextRequest) {
  const person = await member(req);
  if (!person) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const saved = await saveSubscription(person.memberId, person.userId, body?.subscription ?? {});
  // Вкладку могут закрыть сразу после включения: поллер не ждёт минуту до перепроверки.
  invalidatePushWanted();
  return saved
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'BAD_SUBSCRIPTION' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const person = await member(req);
  if (!person) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.endpoint === 'string')
    await removeSubscription(person.memberId, person.userId, body.endpoint);
  invalidatePushWanted();
  return NextResponse.json({ ok: true });
}

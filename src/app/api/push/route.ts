import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { pushConfigured, removeSubscription, saveSubscription, vapidPublicKey } from '@/lib/push';

export const dynamic = 'force-dynamic';

const member = (req: NextRequest) =>
  getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);

// Публичный ключ нужен браузеру, чтобы оформить подписку.
export async function GET(req: NextRequest) {
  if (!(await member(req)))
    return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: 'PUSH_DISABLED' }, { status: 404 });
  return NextResponse.json({ key: vapidPublicKey() });
}

export async function POST(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const saved = await saveSubscription(memberId, body?.subscription ?? {});
  return saved
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'BAD_SUBSCRIPTION' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const memberId = await member(req);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.endpoint === 'string') await removeSubscription(memberId, body.endpoint);
  return NextResponse.json({ ok: true });
}

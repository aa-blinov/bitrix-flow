import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { digestEnabled, sendDigest } from '@/lib/digest';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Отправить недельную сводку сейчас, чтобы проверить каналы. Адресаты только из окружения:
// клиент не выбирает, куда писать от имени владельца токена.
export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  if (!digestEnabled())
    return NextResponse.json({ error: 'DIGEST_NOT_CONFIGURED' }, { status: 409 });
  try {
    return NextResponse.json(await sendDigest());
  } catch (error) {
    console.error('[digest]', error);
    return NextResponse.json({ error: 'BITRIX24_REQUEST_FAILED' }, { status: 502 });
  }
}

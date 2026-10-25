import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sendDigest } from '@/lib/digest';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Отправить недельную сводку сейчас, чтобы посмотреть, как она выглядит. Адресат только
// из DIGEST_DIALOG_ID: клиент не выбирает, куда писать от имени владельца токена.
export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const dialogId = process.env.DIGEST_DIALOG_ID || '';
  if (!dialogId) return NextResponse.json({ error: 'DIGEST_NOT_CONFIGURED' }, { status: 409 });
  try {
    return NextResponse.json({ text: await sendDigest(dialogId) });
  } catch (error) {
    console.error('[digest]', error);
    return NextResponse.json({ error: 'BITRIX24_REQUEST_FAILED' }, { status: 502 });
  }
}

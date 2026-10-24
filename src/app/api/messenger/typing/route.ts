import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// «Печатает…» для собеседников. Клиент шлёт сигнал не чаще раза в несколько секунд.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dialogId = String(body?.dialogId || '');
  if (!DIALOG_ID.test(dialogId))
    return NextResponse.json({ error: 'BAD_DIALOG_ID' }, { status: 400 });
  return withMessenger(req, async (call) => {
    await call('im.dialog.writing', { DIALOG_ID: dialogId }, true);
    return NextResponse.json({ ok: true });
  });
}

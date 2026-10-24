import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

const ACTIONS = ['pin', 'unpin', 'unread', 'mute', 'unmute'] as const;

// Закрепить, пометить непрочитанным, отключить звук: настройки диалога живут в
// Битриксе, поэтому каждое действие это один вызов портала.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dialogId = String(body?.dialogId || '');
  const action = String(body?.action || '');
  if (!DIALOG_ID.test(dialogId) || !(ACTIONS as readonly string[]).includes(action))
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });

  return withMessenger(req, async (call) => {
    if (action === 'pin' || action === 'unpin')
      await call('im.recent.pin', { DIALOG_ID: dialogId, PIN: action === 'pin' ? 'Y' : 'N' }, true);
    else if (action === 'unread')
      await call('im.recent.unread', { DIALOG_ID: dialogId, ACTION: 'Y' }, true);
    else
      await call(
        'im.chat.mute',
        { DIALOG_ID: dialogId, MUTE: action === 'mute' ? 'Y' : 'N' },
        true,
      );
    return NextResponse.json({ ok: true });
  });
}

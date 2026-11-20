import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';
import { invalidateMuted } from '@/lib/messenger-events';

export const dynamic = 'force-dynamic';

const ACTIONS = ['pin', 'unpin', 'unread', 'mute', 'unmute'] as const;

// Закрепить, пометить непрочитанным, отключить звук: настройки диалога живут в
// Битриксе, поэтому каждое действие это один вызов портала.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dialogId = String(body?.dialogId || '');
  const action = String(body?.action || '');
  // «Прочитать все» относится ко всем диалогам сразу, номер диалога ему не нужен.
  if (action === 'readAll')
    return withMessenger(req, async (call) =>
      (await call('im.dialog.read.all', {}, true))
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 }),
    );
  if (!DIALOG_ID.test(dialogId) || !(ACTIONS as readonly string[]).includes(action))
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });

  return withMessenger(req, async (call, memberId, userId) => {
    const result =
      action === 'pin' || action === 'unpin'
        ? await call(
            'im.recent.pin',
            { DIALOG_ID: dialogId, PIN: action === 'pin' ? 'Y' : 'N' },
            true,
          )
        : action === 'unread'
          ? await call('im.recent.unread', { DIALOG_ID: dialogId, ACTION: 'Y' }, true)
          : await call(
              'im.chat.mute',
              { DIALOG_ID: dialogId, MUTE: action === 'mute' ? 'Y' : 'N' },
              true,
            );
    // Без подтверждения портала 502: клиент перечитает список, а не покажет успех.
    if (!result) return NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
    // Иначе поллер ещё до пяти минут звенел бы по заглушённому чату.
    if (action === 'mute' || action === 'unmute') invalidateMuted(memberId, userId);
    return NextResponse.json({ ok: true });
  });
}

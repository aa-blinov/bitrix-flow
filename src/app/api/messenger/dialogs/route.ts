import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { DIALOG_ID, DIALOGS_PAGE, normalizeDialogInfo, normalizeDialogs } from '@/lib/messenger';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  // Один диалог по номеру: так открывается переписка, где человек был до обновления страницы.
  const single = req.nextUrl.searchParams.get('dialogId');
  if (single !== null) {
    if (!DIALOG_ID.test(single))
      return Promise.resolve(NextResponse.json({ error: 'BAD_DIALOG_ID' }, { status: 400 }));
    return withMessenger(req, async (call) => {
      const info = normalizeDialogInfo(await call('im.dialog.get', { DIALOG_ID: single }), single);
      return info
        ? NextResponse.json({ dialog: info })
        : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    });
  }
  // OFFSET портал двигает на размер страницы, а не на число вернувшихся диалогов.
  const raw = req.nextUrl.searchParams.get('offset') || '0';
  const offset = /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  // На следующих страницах me не запрашиваем, клиент присылает его сам: он нужен
  // для признака «звук отключён», который портал хранит списком пользователей.
  const knownMe = Number(req.nextUrl.searchParams.get('me')) || 0;
  return withMessenger(req, async (call) => {
    // Открытые линии (чаты с клиентами из внешних каналов) в мессенджере команды не нужны.
    const [result, me] = await Promise.all([
      call('im.recent.list', {
        SKIP_OPENLINES: 'Y',
        LIMIT: String(DIALOGS_PAGE),
        OFFSET: String(offset),
      }),
      // me нужен клиенту, чтобы отличить свои сообщения от чужих; на следующих страницах он уже известен.
      offset === 0 ? call('user.current') : null,
    ]);
    const meId = Number(me?.ID) || knownMe;
    return NextResponse.json({
      dialogs: normalizeDialogs(result, meId),
      hasMore: Boolean(result?.hasMore ?? result?.hasMorePages),
      nextOffset: offset + DIALOGS_PAGE,
      me: meId,
    });
  });
}

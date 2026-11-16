import { NextRequest, NextResponse } from 'next/server';
import { portalDomain, withMessenger } from '@/lib/messenger-api';
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
      // Портал ответил без id: это сбой ответа, а не «диалога нет». Отсутствие диалога
      // портал сообщает ошибкой, её withMessenger отдаёт как 422.
      return info
        ? NextResponse.json({ dialog: info })
        : NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    });
  }
  // OFFSET портал двигает на размер страницы, а не на число вернувшихся диалогов.
  const raw = req.nextUrl.searchParams.get('offset') || '0';
  const offset = /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  // На следующих страницах me не запрашиваем, клиент присылает его сам: он нужен
  // для признака «звук отключён», который портал хранит списком пользователей.
  const knownMe = Number(req.nextUrl.searchParams.get('me')) || 0;
  return withMessenger(req, async (call, memberId) => {
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
    // Ответ без списка не пустой список: иначе пропали бы диалоги и листание.
    if (!Array.isArray(result?.items))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    const meId = Number(me?.ID) || knownMe;
    // Без своего id свои сообщения выглядели бы чужими: первая страница его обязана знать.
    if (offset === 0 && !(Number(me?.ID) > 0))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    return NextResponse.json({
      dialogs: normalizeDialogs(result, meId),
      hasMore: Boolean(result?.hasMore ?? result?.hasMorePages),
      nextOffset: offset + DIALOGS_PAGE,
      me: meId,
      ...(offset === 0 ? { portal: await portalDomain(memberId) } : {}),
    });
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { DIALOGS_PAGE, normalizeDialogs } from '@/lib/messenger';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  // OFFSET портал двигает на размер страницы, а не на число вернувшихся диалогов.
  const raw = req.nextUrl.searchParams.get('offset') || '0';
  const offset = /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
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
    return NextResponse.json({
      dialogs: normalizeDialogs(result),
      hasMore: Boolean(result?.hasMore ?? result?.hasMorePages),
      nextOffset: offset + DIALOGS_PAGE,
      me: Number(me?.ID) || 0,
    });
  });
}

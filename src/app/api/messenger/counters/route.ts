import { NextRequest, NextResponse } from 'next/server';
import { portalDomain, withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// Число непрочитанных для значка в меню: TYPE.MESSENGER это все чаты без
// уведомлений портала (те считаются отдельно и в мессенджере не нужны).
export function GET(req: NextRequest) {
  return withMessenger(req, async (call, memberId) => {
    const [counters, me, portal] = await Promise.all([
      call('im.counters.get'),
      call('user.current'),
      portalDomain(memberId),
    ]);
    // Без счётчика в ответе число неизвестно: ноль погасил бы значок при непрочитанном.
    const unread = Number(counters?.TYPE?.MESSENGER);
    if (counters?.TYPE?.MESSENGER === undefined || !Number.isFinite(unread))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    return NextResponse.json({
      unread,
      me: Number(me?.ID) || 0,
      // Свой портал для ссылок в тексте: счётчик грузится на каждой странице.
      portal,
    });
  });
}

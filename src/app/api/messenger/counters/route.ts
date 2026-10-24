import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// Число непрочитанных для значка в меню: TYPE.MESSENGER это все чаты без
// уведомлений портала (те считаются отдельно и в мессенджере не нужны).
export function GET(req: NextRequest) {
  return withMessenger(req, async (call) => {
    const [counters, me] = await Promise.all([call('im.counters.get'), call('user.current')]);
    return NextResponse.json({
      unread: Number(counters?.TYPE?.MESSENGER) || 0,
      me: Number(me?.ID) || 0,
    });
  });
}

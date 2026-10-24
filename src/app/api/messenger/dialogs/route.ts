import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { normalizeDialogs } from '@/lib/messenger';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withMessenger(req, async (call) => {
    // Открытые линии (чаты с клиентами из внешних каналов) в мессенджере команды не нужны.
    const [result, me] = await Promise.all([
      call('im.recent.list', { SKIP_OPENLINES: 'Y', LIMIT: '50' }),
      call('user.current'),
    ]);
    // me нужен клиенту, чтобы отличить свои сообщения от чужих.
    return NextResponse.json({ dialogs: normalizeDialogs(result), me: Number(me?.ID) || 0 });
  });
}

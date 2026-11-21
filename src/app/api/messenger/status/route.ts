import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// Статус, который человек ставит себе сам: его видят коллеги в чатах Битрикса.
const STATUSES = new Set(['online', 'dnd', 'away']);

export function GET(req: NextRequest) {
  return withMessenger(req, async (call) => {
    const status = String((await call('im.user.status.get')) || '');
    return NextResponse.json({ status: STATUSES.has(status) ? status : 'online' });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const status = String(body?.status || '');
  if (!STATUSES.has(status)) return NextResponse.json({ error: 'BAD_STATUS' }, { status: 400 });
  return withMessenger(req, async (call) =>
    (await call('im.user.status.set', { STATUS: status }, true))
      ? NextResponse.json({ status })
      : NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 }),
  );
}

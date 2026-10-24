import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// Групповой чат из людей. Чаты проектов и задач так не создаются: они живут
// в Битриксе вместе со своими объектами (im.chat.add с SONET_GROUP дублировал бы их).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const users: number[] = Array.isArray(body?.userIds)
    ? ([...new Set((body.userIds as unknown[]).map(Number))] as number[]).filter(
        (id) => Number.isInteger(id) && id > 0,
      )
    : [];
  if (!title || !users.length || users.length > 100)
    return NextResponse.json({ error: 'BAD_CHAT' }, { status: 400 });

  return withMessenger(req, async (call) => {
    const id = await call('im.chat.add', { TYPE: 'CHAT', TITLE: title, USERS: users }, true, true);
    return NextResponse.json({ dialogId: `chat${Number(id)}` });
  });
}

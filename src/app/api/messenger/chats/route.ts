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
  // Канал можно создать и без участников: в него потом приглашают, а пишут только админы.
  const channel = body?.kind === 'channel';
  if (!title || (!channel && !users.length) || users.length > 100)
    return NextResponse.json({ error: 'BAD_CHAT' }, { status: 400 });

  if (channel)
    return withMessenger(req, async (call) => {
      // Канал создаёт только im.v2.Chat.add, а участников добавляем проверенным
      // im.chat.user.add: канал уже создан, и его номер надо вернуть даже при сбое добавления.
      const created = await call(
        'im.v2.Chat.add',
        { fields: { type: 'CHANNEL', title } },
        true,
        true,
      );
      const id = Number(created?.chatId);
      if (!Number.isInteger(id) || id <= 0)
        return NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
      let membersFailed = false;
      if (users.length)
        await call('im.chat.user.add', { CHAT_ID: id, USERS: users, HIDE_HISTORY: 'N' }, true, true)
          .then((ok: unknown) => (membersFailed = !ok))
          .catch(() => (membersFailed = true));
      return NextResponse.json({ dialogId: `chat${id}`, membersFailed });
    });

  return withMessenger(req, async (call) => {
    const id = Number(
      await call('im.chat.add', { TYPE: 'CHAT', TITLE: title, USERS: users }, true, true),
    );
    // Без номера чата исход неизвестен: открыть «chatNaN» хуже, чем попросить проверить.
    if (!Number.isInteger(id) || id <= 0)
      return NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
    return NextResponse.json({ dialogId: `chat${id}` });
  });
}

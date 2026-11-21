import { NextRequest, NextResponse } from 'next/server';
import { CHAT_COLORS } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

const bad = (error = 'BAD_REQUEST') => NextResponse.json({ error }, { status: 400 });

// Настройки обычного группового чата: название, участники, владелец, выход. Чаты проектов и задач
// сюда не попадают: их состав и название задаёт сам проект или задача в Битриксе.
// Права (кто может добавлять и исключать) проверяет портал, а мы отдаём его отказ как 422.
// Методы чата отвечают true. Ответ без результата не подтверждение: настройки скажут,
// что исход неизвестен, и перечитают чат.
const done = (result: unknown) =>
  result
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const match = /^chat(\d{1,12})$/.exec(String(body?.dialogId || ''));
  const action = String(body?.action || '');
  if (!match) return bad('BAD_DIALOG_ID');
  const chatId = Number(match[1]);

  if (action === 'rename') {
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
    if (!title) return bad('BAD_TITLE');
    return withMessenger(req, async (call) => {
      return done(await call('im.chat.updateTitle', { CHAT_ID: chatId, TITLE: title }, true, true));
    });
  }
  if (action === 'add') {
    const users = (
      [...new Set(((body?.userIds as unknown[]) || []).map(Number))] as number[]
    ).filter((id) => Number.isInteger(id) && id > 0);
    if (!users.length || users.length > 100) return bad('BAD_USERS');
    return withMessenger(req, async (call) => {
      return done(
        await call(
          'im.chat.user.add',
          { CHAT_ID: chatId, USERS: users, HIDE_HISTORY: 'N' },
          true,
          true,
        ),
      );
    });
  }
  if (action === 'remove') {
    const userId = Number(body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) return bad('BAD_USER');
    return withMessenger(req, async (call) => {
      return done(
        await call('im.chat.user.delete', { CHAT_ID: chatId, USER_ID: userId }, true, true),
      );
    });
  }
  // Передать владение: прежний владелец становится обычным участником. Портал разрешает
  // это владельцу и администратору, остальным отказ уходит в настройки как есть.
  if (action === 'owner') {
    const userId = Number(body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) return bad('BAD_USER');
    return withMessenger(req, async (call) => {
      return done(await call('im.chat.setOwner', { CHAT_ID: chatId, USER_ID: userId }, true, true));
    });
  }
  if (action === 'describe') {
    const description =
      typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    return withMessenger(req, async (call) => {
      return done(
        await call(
          'im.v2.Chat.update',
          { dialogId: `chat${chatId}`, fields: { description } },
          true,
          true,
        ),
      );
    });
  }
  if (action === 'color') {
    const color = String(body?.color || '');
    if (!CHAT_COLORS.some((item) => item.name === color)) return bad('BAD_COLOR');
    return withMessenger(req, async (call) => {
      return done(await call('im.chat.updateColor', { CHAT_ID: chatId, COLOR: color }, true));
    });
  }
  // Аватар приходит base64 без префикса data:. Предел с запасом под фото с телефона:
  // портал сам ужимает картинку, а больше 2 МБ тело запроса к нему не пропустит.
  if (action === 'avatar') {
    const avatar = typeof body?.avatar === 'string' ? body.avatar : '';
    if (!avatar || avatar.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(avatar))
      return bad('BAD_AVATAR');
    return withMessenger(req, async (call) => {
      return done(
        await call('im.chat.updateAvatar', { CHAT_ID: chatId, AVATAR: avatar }, true, true),
      );
    });
  }
  if (action === 'leave') {
    return withMessenger(req, async (call) => {
      return done(await call('im.chat.leave', { CHAT_ID: chatId }, true, true));
    });
  }
  return bad('BAD_ACTION');
}

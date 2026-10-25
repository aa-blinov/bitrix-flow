import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

const bad = (error = 'BAD_REQUEST') => NextResponse.json({ error }, { status: 400 });

// Настройки обычного группового чата: название, участники, выход. Чаты проектов и задач
// сюда не попадают: их состав и название задаёт сам проект или задача в Битриксе.
// Права (кто может добавлять и исключать) проверяет портал, а мы отдаём его отказ как 502.
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
      await call('im.chat.updateTitle', { CHAT_ID: chatId, TITLE: title }, true, true);
      return NextResponse.json({ ok: true });
    });
  }
  if (action === 'add') {
    const users = (
      [...new Set(((body?.userIds as unknown[]) || []).map(Number))] as number[]
    ).filter((id) => Number.isInteger(id) && id > 0);
    if (!users.length || users.length > 100) return bad('BAD_USERS');
    return withMessenger(req, async (call) => {
      await call(
        'im.chat.user.add',
        { CHAT_ID: chatId, USERS: users, HIDE_HISTORY: 'N' },
        true,
        true,
      );
      return NextResponse.json({ ok: true });
    });
  }
  if (action === 'remove') {
    const userId = Number(body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) return bad('BAD_USER');
    return withMessenger(req, async (call) => {
      await call('im.chat.user.delete', { CHAT_ID: chatId, USER_ID: userId }, true, true);
      return NextResponse.json({ ok: true });
    });
  }
  if (action === 'leave') {
    return withMessenger(req, async (call) => {
      await call('im.chat.leave', { CHAT_ID: chatId }, true, true);
      return NextResponse.json({ ok: true });
    });
  }
  return bad('BAD_ACTION');
}

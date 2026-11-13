import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID, MESSAGE_ID } from '@/lib/messenger';
import { getDb } from '@/lib/mongo';
import { isMockEnabled } from '@/lib/mock-b24';
import type { MessengerEvent } from '@/lib/messenger-events';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 20_000;
const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

async function read(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const messageId = String(body?.messageId || '');
  return { body, messageId, valid: MESSAGE_ID.test(messageId) };
}

// Лайк: портал сам проверяет, что сообщение видно пользователю.
export async function POST(req: NextRequest) {
  const { body, messageId, valid } = await read(req);
  if (!valid) return badRequest('BAD_MESSAGE_ID');
  const action = body?.action === 'unlike' ? 'minus' : 'plus';
  return withMessenger(req, async (call) => {
    await call('im.message.like', { MESSAGE_ID: messageId, ACTION: action }, true);
    return NextResponse.json({ ok: true });
  });
}

// Правка: автора и срок правки проверяет портал. Пустой текст запрещён здесь,
// потому что im.message.update с пустым MESSAGE удаляет сообщение.
export async function PUT(req: NextRequest) {
  const { body, messageId, valid } = await read(req);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!valid) return badRequest('BAD_MESSAGE_ID');
  if (!text || text.length > MAX_TEXT) return badRequest('BAD_TEXT');
  return withMessenger(req, async (call, memberId) => {
    await call('im.message.update', { MESSAGE_ID: messageId, MESSAGE: text }, true);
    // Правку через im.message.update портал в очередь событий не кладёт (так в документации
    // im.v2), поэтому другие вкладки видели её только при полном перечитывании раз в две
    // минуты. Событие ставим сами, его раздаёт тот же SSE.
    const dialogId = String(body?.dialogId || '');
    // В моке правка не сохраняется, и перечитывание по событию вернуло бы старый текст.
    if (DIALOG_ID.test(dialogId) && !isMockEnabled()) {
      const event: MessengerEvent = {
        type: 'messenger',
        kind: 'update',
        dialogId,
        chatId: 0,
        messageId: Number(messageId),
        authorId: 0,
        author: '',
        chat: '',
        text: '',
        muted: true,
        mentioned: false,
        at: new Date().toISOString(),
      };
      await (
        await getDb()
      )
        .collection('events_stream')
        .insertOne({ member_id: memberId, event, created_at: new Date() })
        .catch(() => {});
    }
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  const { messageId, valid } = await read(req);
  if (!valid) return badRequest('BAD_MESSAGE_ID');
  return withMessenger(req, async (call) => {
    await call('im.message.delete', { MESSAGE_ID: messageId }, true);
    return NextResponse.json({ ok: true });
  });
}

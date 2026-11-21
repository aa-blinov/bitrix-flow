import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID, MESSAGE_ID, isReaction } from '@/lib/messenger';
import { getDb } from '@/lib/mongo';
import { isMockEnabled } from '@/lib/mock-b24';
import type { MessengerEvent } from '@/lib/messenger-events';
import { withMessenger } from '@/lib/messenger-api';

// Методы отвечают true. Без подтверждения исход неизвестен: бросаем ошибку транспорта,
// withMessenger отдаст 502, и клиент перечитает состояние, а не покажет успех.
function confirmed(result: unknown) {
  if (!result) throw new Error('BITRIX24_UNCONFIRMED');
}

export const dynamic = 'force-dynamic';

const MAX_TEXT = 20_000;
const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

async function read(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const messageId = String(body?.messageId || '');
  return { body, messageId, valid: MESSAGE_ID.test(messageId) };
}

// Что можно создать из сообщения (im.message.share): встреча в календаре, пост в ленте или
// обсуждение в отдельной ветке. Задача создаётся своей формой, а не отсюда.
const SHARE_TYPES = new Set(['CALEND', 'POST', 'CHAT']);

// Лайк, реакция, закреп и «создать из сообщения». Права и видимость сообщения проверяет
// портал. v2-методы закрепа отвечают пустым массивом, поэтому их подтверждение это
// отсутствие ошибки, а не true.
export async function POST(req: NextRequest) {
  const { body, messageId, valid } = await read(req);
  if (!valid) return badRequest('BAD_MESSAGE_ID');
  const kind = String(body?.action || '');
  if (kind === 'react' || kind === 'unreact') {
    if (!isReaction(body?.reaction)) return badRequest('BAD_REACTION');
    const method =
      kind === 'react' ? 'im.v2.Chat.Message.Reaction.add' : 'im.v2.Chat.Message.Reaction.delete';
    return withMessenger(req, async (call) => {
      confirmed(
        await call(method, { messageId: Number(messageId), reaction: body.reaction }, true),
      );
      return NextResponse.json({ ok: true });
    });
  }
  if (kind === 'pin' || kind === 'unpin') {
    return withMessenger(req, async (call) => {
      await call(`im.v2.Chat.Message.${kind}`, { messageId: Number(messageId) }, true);
      return NextResponse.json({ ok: true });
    });
  }
  if (kind === 'share') {
    const type = String(body?.type || '');
    const dialogId = String(body?.dialogId || '');
    if (!SHARE_TYPES.has(type)) return badRequest('BAD_SHARE_TYPE');
    if (!DIALOG_ID.test(dialogId)) return badRequest('BAD_DIALOG_ID');
    return withMessenger(req, async (call) => {
      confirmed(
        await call(
          'im.message.share',
          { MESSAGE_ID: messageId, DIALOG_ID: dialogId, TYPE: type },
          true,
        ),
      );
      return NextResponse.json({ ok: true });
    });
  }
  const action = kind === 'unlike' ? 'minus' : 'plus';
  return withMessenger(req, async (call) => {
    confirmed(await call('im.message.like', { MESSAGE_ID: messageId, ACTION: action }, true));
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
  return withMessenger(req, async (call, memberId, userId) => {
    confirmed(await call('im.message.update', { MESSAGE_ID: messageId, MESSAGE: text }, true));
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
        own: true,
        at: new Date().toISOString(),
      };
      // Правка в Битриксе уже прошла: сбой базы не должен выглядеть как неудачная правка.
      try {
        await (
          await getDb()
        )
          .collection('events_stream')
          .insertOne({ member_id: memberId, user_id: userId, event, created_at: new Date() });
      } catch (error) {
        console.warn('[messenger] событие правки не записано', error);
      }
    }
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  const { messageId, valid } = await read(req);
  if (!valid) return badRequest('BAD_MESSAGE_ID');
  return withMessenger(req, async (call) => {
    confirmed(await call('im.message.delete', { MESSAGE_ID: messageId }, true));
    return NextResponse.json({ ok: true });
  });
}

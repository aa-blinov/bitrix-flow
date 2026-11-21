import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import {
  DIALOG_ID,
  MESSAGES_PAGE,
  applyReactions,
  canPostIn,
  normalizeMessages,
  normalizeReaders,
} from '@/lib/messenger';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 20_000;

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

export function GET(req: NextRequest) {
  const dialogId = req.nextUrl.searchParams.get('dialogId') || '';
  if (!DIALOG_ID.test(dialogId)) return Promise.resolve(badRequest('BAD_DIALOG_ID'));
  // Курсоры портала: beforeId отдаёт сообщения старше него (LAST_ID, листание
  // вверх по истории), afterId новее (FIRST_ID, опрос новых). Без них приходят
  // последние сообщения диалога.
  const beforeId = req.nextUrl.searchParams.get('beforeId') || '';
  const afterId = req.nextUrl.searchParams.get('afterId') || '';
  const me = Number(req.nextUrl.searchParams.get('me')) || 0;
  return withMessenger(req, async (call) => {
    // Прочитанность нужна только свежей порции: при листании вверх историю
    // читать заново незачем. Сбой этого вызова не должен ронять сами сообщения.
    const full = !beforeId && !afterId;
    const [result, dialog, chat] = await Promise.all([
      call('im.dialog.messages.get', {
        DIALOG_ID: dialogId,
        LIMIT: String(MESSAGES_PAGE),
        ...(/^\d{1,12}$/.test(beforeId) ? { LAST_ID: beforeId } : {}),
        ...(/^\d{1,12}$/.test(afterId) ? { FIRST_ID: afterId } : {}),
      }),
      beforeId ? null : call('im.dialog.get', { DIALOG_ID: dialogId }).catch(() => null),
      // Закреплённые сообщения отдаёт только im.v2.Chat.load. Берём их при открытии и полном
      // перечитывании (раз в несколько опросов), а не на каждый опрос новых.
      full ? call('im.v2.Chat.load', { dialogId, limit: 1 }).catch(() => null) : null,
    ]);
    // Ответ без списка сообщений не пустая история: иначе полное перечитывание стёрло бы её.
    if (!Array.isArray(result?.messages))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    const normalized = normalizeMessages(result);
    // Старый метод сводит любую реакцию в LIKE. Коды берём из im.v2 той же порцией, и только
    // если в ней есть отметки: опрос без реакций лишнего вызова портала не делает.
    const liked = normalized.messages.filter((message) => message.likes.length);
    if (liked.length && Number(result.chat_id) > 0) {
      const first = normalized.messages[0].id;
      const tail = await call(
        'im.v2.Chat.Message.tail',
        {
          chatId: Number(result.chat_id),
          filter: { lastId: first - 1 },
          order: { id: 'ASC' },
          limit: normalized.messages.length,
        },
        false,
        true,
      ).catch(() => null);
      normalized.messages = applyReactions(normalized.messages, tail?.reactions);
    }
    return NextResponse.json({
      ...normalized,
      ...(chat ? { pins: pinsOf(chat) } : {}),
      ...(dialog
        ? {
            readers: normalizeReaders(dialog, me),
            canPost: canPostIn(dialog),
            role: String(dialog.role || ''),
          }
        : {}),
    });
  });
}

type Pin = { id: number; authorId: number; text: string };

// Закреп чата: im.v2.Chat.load отдаёт номера в pins, а сами сообщения в messages и
// additionalMessages. Сообщение, которого в ответе нет, всё равно показываем по номеру.
function pinsOf(chat: {
  pins?: { messageId?: unknown }[];
  messages?: { id?: unknown; authorId?: unknown; text?: unknown }[];
  additionalMessages?: { id?: unknown; authorId?: unknown; text?: unknown }[];
}): Pin[] {
  const bodies = new Map<number, { authorId?: unknown; text?: unknown }>();
  for (const message of [...(chat?.messages || []), ...(chat?.additionalMessages || [])])
    bodies.set(Number(message?.id), message);
  return (Array.isArray(chat?.pins) ? chat.pins : [])
    .map((pin) => {
      const body = bodies.get(Number(pin?.messageId));
      return {
        id: Number(pin?.messageId) || 0,
        authorId: Number(body?.authorId) || 0,
        text: String(body?.text || ''),
      };
    })
    .filter((pin) => pin.id > 0);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dialogId = String(body?.dialogId || '');
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!DIALOG_ID.test(dialogId)) return badRequest('BAD_DIALOG_ID');
  if (!text || text.length > MAX_TEXT) return badRequest('BAD_TEXT');
  return withMessenger(req, async (call) => {
    const id = Number(await call('im.message.add', { DIALOG_ID: dialogId, MESSAGE: text }, true));
    // Ответ без номера сообщения: дошло ли, неизвестно. 502 клиент так и показывает.
    if (!id) return NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
    return NextResponse.json({ id });
  });
}

// Открытый диалог помечается прочитанным, как в самом Битриксе.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dialogId = String(body?.dialogId || '');
  if (!DIALOG_ID.test(dialogId)) return badRequest('BAD_DIALOG_ID');
  // Граница прочитанного: только до последнего показанного сообщения. Пришедшее после
  // загрузки страницы остаётся непрочитанным.
  const messageId = Number(body?.messageId) || 0;
  return withMessenger(req, async (call) => {
    const done = await call(
      'im.dialog.read',
      { DIALOG_ID: dialogId, ...(messageId > 0 ? { MESSAGE_ID: String(messageId) } : {}) },
      true,
    );
    // Без подтверждения портала клиент вернёт счётчик и повторит отметку.
    if (!done) return NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
    return NextResponse.json({ ok: true });
  });
}

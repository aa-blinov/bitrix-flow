import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import {
  DIALOG_ID,
  MESSAGES_PAGE,
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
    const [result, dialog] = await Promise.all([
      call('im.dialog.messages.get', {
        DIALOG_ID: dialogId,
        LIMIT: String(MESSAGES_PAGE),
        ...(/^\d{1,12}$/.test(beforeId) ? { LAST_ID: beforeId } : {}),
        ...(/^\d{1,12}$/.test(afterId) ? { FIRST_ID: afterId } : {}),
      }),
      beforeId ? null : call('im.dialog.get', { DIALOG_ID: dialogId }).catch(() => null),
    ]);
    // Ответ без списка сообщений не пустая история: иначе полное перечитывание стёрло бы её.
    if (!Array.isArray(result?.messages))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    return NextResponse.json({
      ...normalizeMessages(result),
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

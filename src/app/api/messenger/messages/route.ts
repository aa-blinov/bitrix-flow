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
    return NextResponse.json({
      ...normalizeMessages(result),
      ...(dialog ? { readers: normalizeReaders(dialog, me), canPost: canPostIn(dialog) } : {}),
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
    const id = await call('im.message.add', { DIALOG_ID: dialogId, MESSAGE: text }, true);
    return NextResponse.json({ id: Number(id) || null });
  });
}

// Открытый диалог помечается прочитанным, как в самом Битриксе.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dialogId = String(body?.dialogId || '');
  if (!DIALOG_ID.test(dialogId)) return badRequest('BAD_DIALOG_ID');
  return withMessenger(req, async (call) => {
    await call('im.dialog.read', { DIALOG_ID: dialogId }, true);
    return NextResponse.json({ ok: true });
  });
}

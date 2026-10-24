import { NextRequest, NextResponse } from 'next/server';
import { MESSAGE_ID } from '@/lib/messenger';
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
  return withMessenger(req, async (call) => {
    await call('im.message.update', { MESSAGE_ID: messageId, MESSAGE: text }, true);
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

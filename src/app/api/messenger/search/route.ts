import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID, normalizeMessages } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// Поиск по сообщениям одного диалога. Метод портала ищет по номеру чата, а у
// личного диалога в адресе стоит номер человека, поэтому номер чата берём у портала.
export function GET(req: NextRequest) {
  const dialogId = req.nextUrl.searchParams.get('dialogId') || '';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 100);
  if (!DIALOG_ID.test(dialogId))
    return Promise.resolve(NextResponse.json({ error: 'BAD_DIALOG_ID' }, { status: 400 }));
  if (q.length < 2) return Promise.resolve(NextResponse.json({ messages: [], people: {} }));

  return withMessenger(req, async (call) => {
    const chatId = dialogId.startsWith('chat')
      ? dialogId.slice(4)
      : String((await call('im.dialog.get', { DIALOG_ID: dialogId }))?.id || '');
    if (!chatId) return NextResponse.json({ messages: [], people: {} });
    const result = await call('im.dialog.messages.search', {
      CHAT_ID: chatId,
      SEARCH_MESSAGE: q,
      LIMIT: 30,
    });
    return NextResponse.json(normalizeMessages(result));
  });
}

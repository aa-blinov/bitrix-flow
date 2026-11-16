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
    // Без номера чата поиск не выполнен: это сбой ответа портала, а не пустой результат.
    if (!/^\d+$/.test(chatId))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    const result = await call('im.dialog.messages.search', {
      CHAT_ID: chatId,
      SEARCH_MESSAGE: q,
      LIMIT: 30,
    });
    // Ответ без списка не «ничего не найдено»: клиент должен показать сбой поиска.
    if (!Array.isArray(result?.messages))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    return NextResponse.json(normalizeMessages(result));
  });
}

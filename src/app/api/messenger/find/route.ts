import { NextRequest, NextResponse } from 'next/server';
import { normalizeChatHits } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// Поиск чатов по всему порталу: список диалогов знает только последние, а нужный чат
// может лежать глубже. Портал ищет от двух букв.
export function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 2) return Promise.resolve(NextResponse.json({ dialogs: [] }));
  return withMessenger(req, async (call) => {
    const result = await call('im.search.chat.list', { FIND: q, LIMIT: 15 });
    // Ответ без списка не «чаты не найдены»: клиент покажет сбой поиска.
    if (!Array.isArray(result))
      return NextResponse.json({ error: 'BAD_PORTAL_RESPONSE' }, { status: 502 });
    return NextResponse.json({ dialogs: normalizeChatHits(result) });
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID, normalizeUsers } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

// Люди для нового диалога (?q=, поиск по порталу от двух букв: так требует
// im.search.user.list) и для упоминаний (?dialogId=, участники чата).
export function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 60);
  const dialogId = req.nextUrl.searchParams.get('dialogId') || '';
  if (dialogId && !DIALOG_ID.test(dialogId))
    return Promise.resolve(NextResponse.json({ error: 'BAD_DIALOG_ID' }, { status: 400 }));
  if (!dialogId && q.length < 2) return Promise.resolve(NextResponse.json({ users: [] }));

  return withMessenger(req, async (call) => {
    const result = dialogId
      ? await call('im.dialog.users.list', { DIALOG_ID: dialogId, LIMIT: 200 })
      : await call('im.search.user.list', { FIND: q, LIMIT: 15 });
    return NextResponse.json({ users: normalizeUsers(result) });
  });
}

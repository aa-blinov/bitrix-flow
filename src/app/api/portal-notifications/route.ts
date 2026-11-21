import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { normalizePortalNotifications } from '@/lib/portal-notifications';

export const dynamic = 'force-dynamic';

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const PAGE = 50;

// Колокольчик Битрикса: личные уведомления, поэтому только токен самого человека.
// Курсор портала это номер и тип последнего уведомления прошлой страницы.
export function GET(req: NextRequest) {
  const lastId = req.nextUrl.searchParams.get('lastId') || '';
  const lastType = req.nextUrl.searchParams.get('lastType') || '';
  // Только счётчик: im.counters.get дешевле списка и ничего не отмечает прочитанным.
  if (req.nextUrl.searchParams.get('count'))
    return withMessenger(req, async (call) => {
      const counters = await call('im.counters.get');
      return NextResponse.json({ unread: Number(counters?.TYPE?.NOTIFY) || 0 });
    });
  return withMessenger(req, async (call) => {
    const result = await call('im.notify.get', {
      LIMIT: PAGE,
      ...(/^\d{1,12}$/.test(lastId) && /^\d$/.test(lastType)
        ? { LAST_ID: lastId, LAST_TYPE: lastType }
        : {}),
    });
    const page = normalizePortalNotifications(result);
    return NextResponse.json({ ...page, hasMore: page.items.length >= PAGE });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const action = String(body?.action || '');
  const id = Number(body?.id);
  const validId = Number.isInteger(id) && id > 0;

  // Прочитано или снова непрочитано, списком: так отмечается страница при открытии.
  if (action === 'read') {
    const ids = ([...new Set(((body?.ids as unknown[]) || []).map(Number))] as number[]).filter(
      (item) => Number.isInteger(item) && item > 0,
    );
    if (!ids.length || ids.length > 200) return bad('BAD_IDS');
    return withMessenger(req, async (call) =>
      // JSON: массив IDS форма передаёт так, что портал его не видит (PARAMS_ERROR).
      (await call(
        'im.notify.read.list',
        { IDS: ids, ACTION: body?.unread ? 'N' : 'Y' },
        true,
        true,
      ))
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 }),
    );
  }
  if (!validId) return bad('BAD_ID');
  // Кнопка «Принять» или «Отказаться»: портал выполняет её и сам удаляет уведомление.
  if (action === 'confirm') {
    const value = String(body?.value || '');
    if (!/^[\w-]{1,32}$/.test(value)) return bad('BAD_VALUE');
    return withMessenger(req, async (call) => {
      const result = await call('im.notify.confirm', { NOTIFY_ID: id, NOTIFY_VALUE: value }, true);
      // false значит, что уведомление уже обработано или кнопок у него нет.
      if (!result?.result_message) return NextResponse.json({ error: 'GONE' }, { status: 409 });
      return NextResponse.json({ message: [result.result_message].flat().join(' ') });
    });
  }
  if (action === 'answer') {
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 5000) : '';
    if (!text) return bad('BAD_TEXT');
    return withMessenger(req, async (call) => {
      const result = await call('im.notify.answer', { NOTIFY_ID: id, ANSWER_TEXT: text }, true);
      if (!result?.result_message) return NextResponse.json({ error: 'GONE' }, { status: 409 });
      return NextResponse.json({ ok: true });
    });
  }
  if (action === 'delete') {
    return withMessenger(req, async (call) =>
      (await call('im.notify.delete', { ID: id }, true))
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'GONE' }, { status: 409 }),
    );
  }
  return bad('BAD_ACTION');
}

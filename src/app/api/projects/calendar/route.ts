import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { normalizeEvents } from '@/lib/project-life';

export const dynamic = 'force-dynamic';

const groupId = (value: unknown) => (/^\d+$/.test(String(value || '')) ? String(value) : '');
const day = (value: unknown) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
const moment = (value: unknown) =>
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(value || '')) ? String(value) : '';

// Календарь группы портала: встречи проекта. Токен человека, как и у ленты.
export function GET(req: NextRequest) {
  const id = groupId(req.nextUrl.searchParams.get('projectId'));
  const from = day(req.nextUrl.searchParams.get('from'));
  const to = day(req.nextUrl.searchParams.get('to'));
  if (!id || !from || !to)
    return Promise.resolve(NextResponse.json({ error: 'BAD_RANGE' }, { status: 400 }));
  return withMessenger(req, async (call) => {
    const result = await call('calendar.event.get', { type: 'group', ownerId: id, from, to });
    return NextResponse.json({ events: normalizeEvents(result) });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = groupId(body?.projectId);
  const name = String(body?.name || '')
    .trim()
    .slice(0, 255);
  const from = moment(body?.from);
  const to = moment(body?.to) || from;
  const allDay = from.length === 10;
  if (!id || !name || !from) return NextResponse.json({ error: 'BAD_EVENT' }, { status: 400 });
  return withMessenger(req, async (call) => {
    // Событие кладётся в раздел календаря: у проекта он один, его создаёт портал.
    const sections = await call('calendar.section.get', { type: 'group', ownerId: id });
    const section = Array.isArray(sections)
      ? sections.find((item: any) => item?.PERM?.add !== false)
      : null;
    if (!section) return NextResponse.json({ error: 'NO_CALENDAR_SECTION' }, { status: 422 });
    const result = await call(
      'calendar.event.add',
      {
        type: 'group',
        ownerId: id,
        section: section.ID,
        name,
        from: from.replace('T', ' '),
        to: to.replace('T', ' '),
        skip_time: allDay ? 'Y' : 'N',
      },
      true,
    );
    return NextResponse.json({ id: String(result ?? '') });
  });
}

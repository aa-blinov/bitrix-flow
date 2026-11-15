import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { cleanWidget, runWidget, type Widget } from '@/lib/dashboards';
import { loadHours, weekStarts } from '@/lib/hours';
import { loadEntries, loadTasks } from '@/lib/pm-reports-data';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Все виджеты экрана одним запросом: задачи и списания читаются из базы один раз. */
export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const from = String(body?.from || '');
  const to = String(body?.to || '');
  if (!DAY.test(from) || !DAY.test(to) || from > to)
    return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  const widgets: Widget[] = (Array.isArray(body.widgets) ? body.widgets : [])
    .slice(0, 40)
    .map(cleanWidget);
  const needsHours = widgets.some((widget) => widget.metric === 'hours');
  const needsClasses = widgets.some((widget) => widget.metric === 'hours' && widget.by === 'class');
  const [tasks, hours, classesReport] = await Promise.all([
    loadTasks(memberId),
    needsHours ? loadEntries(memberId, weekStarts(from, to)) : null,
    needsClasses ? loadHours(memberId, from, to) : null,
  ]);
  // Класс задачи тот же, что в аналитике часов: свой тег, тег предка или класс проекта.
  const classes = new Map(
    (classesReport?.rows || []).map((row) => [row.taskId, String(row.hourClass)]),
  );
  const data = { tasks, entries: hours?.entries || [], classes };
  return NextResponse.json({
    results: Object.fromEntries(
      widgets.map((widget) => [widget.id, runWidget(widget, data, from, to)]),
    ),
    collectedFrom: hours?.collectedFrom || null,
  });
}

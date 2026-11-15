import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { cleanWidget, drillWidget, runWidget, type Widget } from '@/lib/dashboards';
import { loadHours, weekStarts } from '@/lib/hours';
import { loadEntries, loadTasks } from '@/lib/pm-reports-data';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PERIOD_MS = 731 * 86_400_000;

/** Все виджеты экрана одним запросом: задачи и списания читаются из базы один раз. */
export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const from = String(body?.from || '');
  const to = String(body?.to || '');
  if (!DAY.test(from) || !DAY.test(to) || from > to)
    return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  // Период длиннее двух лет ПМ не нужен, а списания за него это лишняя нагрузка на базу.
  if (Date.parse(to) - Date.parse(from) > MAX_PERIOD_MS)
    return NextResponse.json({ error: 'PERIOD_TOO_LONG' }, { status: 400 });
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
  // drill: задачи за числом или точкой первого виджета, ключ null это весь итог.
  if (body.drill && widgets[0]) {
    const key = body.drill.key === null ? null : String(body.drill.key ?? '').slice(0, 32);
    const rows = drillWidget(widgets[0], data, from, to, key);
    return NextResponse.json({ tasks: rows.slice(0, 500), total: rows.length });
  }
  return NextResponse.json({
    results: Object.fromEntries(
      widgets.map((widget) => [widget.id, runWidget(widget, data, from, to)]),
    ),
    collectedFrom: hours?.collectedFrom || null,
  });
}

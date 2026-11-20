import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { cleanWidget, drillWidget, runWidget, type Widget } from '@/lib/dashboards';
import { excludedUsers, loadHours, weekStarts } from '@/lib/hours';
import { closedNoDate, loadEntries, loadTasks } from '@/lib/pm-reports-data';
import { shiftDay } from '@/lib/pm-reports';
import { validPeriod } from '@/lib/report-period';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Метрики по дате закрытия: только им мешает завершённая задача без этой даты. */
const CLOSED_METRICS = ['closed', 'late', 'onTime', 'leadTime'];
const MAX_PERIOD_MS = 731 * 86_400_000;

/** Все виджеты экрана одним запросом: задачи и списания читаются из базы один раз. */
export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const from = String(body?.from || '');
  const to = String(body?.to || '');
  if (!validPeriod(from, to))
    return NextResponse.json({ error: 'INVALID_PERIOD' }, { status: 400 });
  // Период длиннее двух лет ПМ не нужен, а списания за него это лишняя нагрузка на базу.
  if (Date.parse(to) - Date.parse(from) > MAX_PERIOD_MS)
    return NextResponse.json({ error: 'PERIOD_TOO_LONG' }, { status: 400 });
  // Считаем до сегодняшнего дня по Москве: списание, внесённое на будущую дату, не
  // часть периода, а будущая неделя не ноль часов. Период целиком в будущем пустой.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const end = from > today ? shiftDay(from, -1) : to > today ? today : to;
  // Проект на весь экран сильнее проекта виджета: «Один проект» хранит проект в каждом
  // виджете, и выбор другого проекта сверху иначе не менял ни одного числа.
  // 'all' снимает проекты виджетов: «Все проекты» сверху должно значить весь портал.
  const projectId = String(body.projectId || '').slice(0, 32);
  const widgets: Widget[] = (Array.isArray(body.widgets) ? body.widgets : [])
    .slice(0, 40)
    .map(cleanWidget)
    .map((widget: Widget) =>
      projectId ? { ...widget, projectId: projectId === 'all' ? '' : projectId } : widget,
    );
  const needsHours = widgets.some((widget) => widget.metric === 'hours');
  const needsClasses = widgets.some((widget) => widget.metric === 'hours' && widget.by === 'class');
  const [tasks, classesReport] = await Promise.all([
    loadTasks(memberId),
    needsClasses ? loadHours(memberId, from, end) : null,
  ]);
  const hours = needsHours ? await loadEntries(memberId, weekStarts(from, end), tasks) : null;
  // Класс задачи тот же, что в аналитике часов: свой тег, тег предка или класс проекта.
  const classes = new Map(
    (classesReport?.rows || []).map((row) => [row.taskId, String(row.hourClass)]),
  );
  const data = {
    tasks,
    entries: hours?.entries || [],
    classes,
    missingWeeks: hours?.coverage.missingWeeks || [],
    extraTasks: hours?.extra || [],
  };
  // drill: задачи за числом или точкой первого виджета, ключ null это весь итог.
  if (body.drill && widgets[0]) {
    const key = body.drill.key === null ? null : String(body.drill.key ?? '').slice(0, 32);
    const rows = drillWidget(widgets[0], data, from, end, key);
    const offset = Math.max(0, Math.floor(Number(body.drill.offset) || 0));
    return NextResponse.json({ tasks: rows.slice(offset, offset + 200), total: rows.length });
  }
  const closedScope = widgets.filter((widget) => CLOSED_METRICS.includes(widget.metric));
  return NextResponse.json({
    results: Object.fromEntries(
      widgets.map((widget) => [widget.id, runWidget(widget, data, from, end)]),
    ),
    // Область предупреждения та же, что у виджетов: если все они про один проект,
    // задачи без даты закрытия в других проектах к экрану не относятся.
    closedNoDate: closedScope.length
      ? closedNoDate(
          tasks,
          // Область та же, что у виджетов по закрытию: если все они про один проект,
          // задачи без даты закрытия в других проектах к экрану не относятся.
          new Set(closedScope.map((widget) => widget.projectId)).size === 1
            ? closedScope[0].projectId || null
            : null,
        )
      : 0,
    coverage: hours?.coverage || null,
    emptyMirror: tasks.length === 0,
    excludedUsers: needsHours ? (await excludedUsers()).size : 0,
  });
}

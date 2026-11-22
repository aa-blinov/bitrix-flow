import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { normalizeLinks, type GanttLink } from '@/lib/gantt';

export const dynamic = 'force-dynamic';

const ids = (value: unknown) =>
  String(value || '')
    .split(',')
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 150);

// Связи Ганта читает только REST v3, и только по одной задаче за вызов. Шесть запросов
// одновременно: больше портал режет лимитом, последовательно сотня задач грузится минуту.
export function GET(req: NextRequest) {
  const list = ids(req.nextUrl.searchParams.get('ids'));
  return withMessenger(req, async (call) => {
    const links: GanttLink[] = [];
    const queue = [...list];
    await Promise.all(
      Array.from({ length: Math.min(6, queue.length) }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          const result = await call(
            'tasks.task.gantt.link.list',
            { filter: ['taskId', Number(id)], pagination: { limit: 1000 } },
            false,
            true,
            true,
          ).catch(() => null);
          links.push(...normalizeLinks(result));
        }
      }),
    );
    return NextResponse.json({ links });
  });
}

// Связь «финиш → старт»: зависимая задача начинается, когда закончится предшественник.
async function change(req: NextRequest, method: 'task.dependence.add' | 'task.dependence.delete') {
  const body = await req.json().catch(() => null);
  const [from] = ids(body?.from);
  const [to] = ids(body?.to);
  if (!from || !to || from === to) return NextResponse.json({ error: 'BAD_LINK' }, { status: 400 });
  return withMessenger(req, async (call) => {
    await call(
      method,
      {
        taskIdFrom: Number(from),
        taskIdTo: Number(to),
        ...(method === 'task.dependence.add' ? { linkType: 2 } : {}),
      },
      true,
      true,
    );
    return NextResponse.json({ ok: true });
  });
}

export const POST = (req: NextRequest) => change(req, 'task.dependence.add');
export const DELETE = (req: NextRequest) => change(req, 'task.dependence.delete');

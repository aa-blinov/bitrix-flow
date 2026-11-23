import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { normalizeLinks, type GanttLink } from '@/lib/gantt';

export const dynamic = 'force-dynamic';

const ids = (value: unknown) =>
  String(value || '')
    .split(',')
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 150);

// Связи Ганта читает только REST v3, и только по одной задаче за вызов: фильтр «in» по
// taskId портал отвергает. Поэтому batch v3 по 50 вызовов: проект на 150 задач это три
// запроса параллельно, около секунды, а по одному запросу на задачу выходило 11 секунд.
export function GET(req: NextRequest) {
  const list = ids(req.nextUrl.searchParams.get('ids'));
  return withMessenger(req, async (call) => {
    const chunks = Array.from({ length: Math.ceil(list.length / 50) }, (_, i) =>
      list.slice(i * 50, i * 50 + 50),
    );
    const results = await Promise.all(
      chunks.map((chunk) =>
        call(
          'batch',
          chunk.map((id) => ({
            method: 'tasks.task.gantt.link.list',
            query: { filter: ['taskId', Number(id)], pagination: { limit: 1000 } },
          })),
          false,
          true,
          true,
        ).catch(() => null),
      ),
    );
    const links: GanttLink[] = results.flatMap((result) =>
      (Array.isArray(result) ? result : []).flatMap((item) => normalizeLinks(item)),
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

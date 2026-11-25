import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { serverCache } from '@/lib/server-cache';

export const dynamic = 'force-dynamic';

export type PlanTask = { id: string; title: string; deadline: string; groupId: string };
export type PlanStage = { id: string; title: string; color: string; tasks: PlanTask[] };

// «Мой план» у каждого свой, поэтому только токен человека: токен портала вернул бы
// план владельца приложения. Стадии это task.stages.get с entityId 0.
// Строка команды классического batch: tasks.task.list?filter[STAGES_ID]=31&select[0]=ID…
function command(method: string, params: Record<string, unknown>) {
  const query = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value && typeof value === 'object')
      for (const [inner, item] of Object.entries(value)) add(`${key}[${inner}]`, item);
    else query.append(key, String(value));
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return `${method}?${query.toString()}`;
}

export function GET(req: NextRequest) {
  return withMessenger(req, async (call, memberId, userId) => {
    // Стадии плана меняют редко, а их запрос стоял перед всеми остальными: кэшируем.
    const stages = await serverCache(
      `${memberId}:${userId}:plan-stages`,
      async () => {
        const raw = await call('task.stages.get', { entityId: 0 });
        return (Array.isArray(raw) ? raw : Object.values(raw || {}))
          .map((stage: any) => ({
            id: String(stage.ID),
            title: String(stage.TITLE || ''),
            color: String(stage.COLOR || ''),
            sort: Number(stage.SORT) || 0,
          }))
          .sort((a, b) => a.sort - b.sort);
      },
      5 * 60_000,
    );
    const query = (id: string, start: number) => ({
      // Личная стадия лежит в STAGES_ID. STAGE_ID это стадия доски проекта: по нему
      // проверка на портале показала 19 случайных задач из 100. Нераспланированные
      // портал сам держит в первой стадии. MEMBER оставляет только задачи человека.
      filter: { STAGES_ID: Number(id), MEMBER: Number(userId), '!STATUS': 5 },
      select: ['ID', 'TITLE', 'DEADLINE', 'GROUP_ID'],
      order: { DEADLINE: 'asc' },
      start,
    });
    // Первые страницы всех стадий одним batch: раньше на каждую стадию шёл свой запрос.
    const first = await call(
      'batch',
      {
        halt: 0,
        cmd: Object.fromEntries(
          stages.map(({ id }) => [`s${id}`, command('tasks.task.list', query(id, 0))]),
        ),
      },
      false,
      true,
    ).catch(() => null);
    const result: PlanStage[] = await Promise.all(
      stages.map(async ({ id, title, color }) => {
        const head = first?.result?.[`s${id}`];
        const tasks: any[] = [...((head?.tasks || head || []) as any[])].filter(Boolean);
        // ponytail: до 4 страниц по 50, дальше колонка обрезается; хватит, пока в плане не сотни задач.
        for (let start = 50; tasks.length === start && start < 200; start += 50) {
          const list = await call('tasks.task.list', query(id, start), false, true).catch(
            () => null,
          );
          const page = (list?.tasks || list || []) as any[];
          if (!Array.isArray(page) || !page.length) break;
          tasks.push(...page);
        }
        return {
          id,
          title,
          color,
          tasks: tasks.map((task) => ({
            id: String(task.id ?? task.ID),
            title: String(task.title ?? task.TITLE ?? ''),
            deadline: String(task.deadline ?? task.DEADLINE ?? ''),
            groupId: String(task.groupId ?? task.GROUP_ID ?? '0'),
          })),
        };
      }),
    );
    return NextResponse.json({ stages: result });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const taskId = /^\d+$/.test(String(body?.taskId)) ? Number(body.taskId) : 0;
  const stageId = /^\d+$/.test(String(body?.stageId)) ? Number(body.stageId) : 0;
  if (!taskId || !stageId) return NextResponse.json({ error: 'BAD_MOVE' }, { status: 400 });
  return withMessenger(req, async (call) => {
    // Портал сам понимает по стадии, что это личный план, а не доска группы.
    await call('task.stages.movetask', { id: taskId, stageId }, true, true);
    return NextResponse.json({ ok: true });
  });
}

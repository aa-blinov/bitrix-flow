import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

export type PlanTask = { id: string; title: string; deadline: string; groupId: string };
export type PlanStage = { id: string; title: string; color: string; tasks: PlanTask[] };

// «Мой план» у каждого свой, поэтому только токен человека: токен портала вернул бы
// план владельца приложения. Стадии это task.stages.get с entityId 0.
export function GET(req: NextRequest) {
  return withMessenger(req, async (call, _memberId, userId) => {
    const raw = await call('task.stages.get', { entityId: 0 });
    const stages = (Array.isArray(raw) ? raw : Object.values(raw || {}))
      .map((stage: any) => ({
        id: String(stage.ID),
        title: String(stage.TITLE || ''),
        color: String(stage.COLOR || ''),
        sort: Number(stage.SORT) || 0,
      }))
      .sort((a, b) => a.sort - b.sort);
    const result: PlanStage[] = await Promise.all(
      stages.map(async ({ id, title, color }) => {
        const tasks: any[] = [];
        // ponytail: до 4 страниц по 50, дальше колонка обрезается; хватит, пока в плане не сотни задач.
        for (let start = 0; start < 200; start += 50) {
          const list = await call(
            'tasks.task.list',
            {
              // Личная стадия лежит в STAGES_ID. STAGE_ID это стадия доски проекта: по нему
              // проверка на портале показала 19 случайных задач из 100. Нераспланированные
              // портал сам держит в первой стадии. MEMBER оставляет только задачи человека.
              filter: { STAGES_ID: Number(id), MEMBER: Number(userId), '!STATUS': 5 },
              select: ['ID', 'TITLE', 'DEADLINE', 'GROUP_ID'],
              order: { DEADLINE: 'asc' },
              start,
            },
            false,
            true,
          ).catch(() => null);
          const page = (list?.tasks || list || []) as any[];
          if (!Array.isArray(page)) break;
          tasks.push(...page);
          if (page.length < 50) break;
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

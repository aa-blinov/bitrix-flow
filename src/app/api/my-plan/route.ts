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
      stages.map(async ({ id, title, color }, index) => {
        const list = await call(
          'tasks.task.list',
          {
            // Задачи, которые человек ещё не раскладывал, лежат со стадией 0 и видны в первой
            // колонке. Документация пишет, что 0 добавлять не нужно, но портал без него
            // отдаёт пустую колонку. MEMBER оставляет только задачи самого человека.
            filter: {
              STAGE_ID: index === 0 ? [0, Number(id)] : Number(id),
              MEMBER: Number(userId),
              '!STATUS': 5,
            },
            select: ['ID', 'TITLE', 'DEADLINE', 'GROUP_ID'],
            order: { DEADLINE: 'asc' },
          },
          false,
          true,
        ).catch(() => null);
        const tasks = (list?.tasks || list || []) as any[];
        return {
          id,
          title,
          color,
          tasks: (Array.isArray(tasks) ? tasks : []).map((task) => ({
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

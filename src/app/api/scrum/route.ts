import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import {
  createSprint,
  isScrum,
  isSize,
  loadBoard,
  moveTask,
  setScrum,
  setSize,
  type Call,
} from '@/lib/scrum';

export const dynamic = 'force-dynamic';

const id = (value: unknown) => (/^\d{1,12}$/.test(String(value ?? '')) ? String(value) : '');
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

// Доска спринтов проекта. Всё личным токеном человека: права на скрам проверяет сам портал,
// а токен портала дал бы любому вошедшему действовать от имени владельца приложения.
export function GET(req: NextRequest) {
  const projectId = id(req.nextUrl.searchParams.get('projectId'));
  if (!projectId) return Promise.resolve(bad('BAD_PROJECT'));
  // check: странице проекта нужен только признак скрама для вкладки, а не вся доска.
  const check = req.nextUrl.searchParams.has('check');
  return withMessenger(req, async (call, memberId) =>
    NextResponse.json(
      check
        ? { scrum: await isScrum(call as Call, projectId) }
        : await loadBoard(call as Call, memberId, projectId),
    ),
  );
}

// Одно действие за запрос: мутации портала не повторяются (повтор POST это второй спринт).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const projectId = id(body?.projectId);
  if (!projectId) return bad('BAD_PROJECT');
  return withMessenger(req, async (rawCall, _memberId, userId) => {
    const call = rawCall as Call;
    if (body?.action === 'setScrum')
      return NextResponse.json({
        scrum: await setScrum(call, projectId, userId, body.on === true),
      });
    if (!(await isScrum(call, projectId))) return bad('NOT_SCRUM');
    switch (body?.action) {
      case 'createSprint':
        return NextResponse.json(
          await createSprint(
            call,
            projectId,
            userId,
            typeof body.name === 'string' ? body.name : '',
          ),
        );
      case 'startSprint':
        if (!id(body.sprintId)) return bad('BAD_SPRINT');
        return NextResponse.json(
          await call('tasks.api.scrum.sprint.start', { id: Number(body.sprintId) }, true, true),
        );
      case 'completeSprint':
        // Завершение берёт скрам, а не спринт: активный у проекта один. Хвост портал сам
        // переносит в бэклог.
        return NextResponse.json(
          await call('tasks.api.scrum.sprint.complete', { id: Number(projectId) }, true, true),
        );
      case 'moveTask': {
        const target = body.to === 'backlog' ? 'backlog' : id(body.to);
        if (!id(body.taskId) || !target) return bad('BAD_MOVE');
        return NextResponse.json(await moveTask(call, projectId, userId, id(body.taskId), target));
      }
      case 'setSize':
        if (!id(body.taskId) || !(body.size === '' || isSize(body.size))) return bad('BAD_SIZE');
        return NextResponse.json(
          await setSize(call, projectId, userId, id(body.taskId), body.size),
        );
      default:
        return bad('UNKNOWN_ACTION');
    }
  });
}

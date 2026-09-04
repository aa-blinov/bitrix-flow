// Batched server-side fetch of tasks across all member's projects.
// На холодном старте: читает MongoDB → для проектов без кэша параллельно
// фетчит из Битрикса → пишет обратно → возвращает. На прогретом кэше —
// моментальный read без обращения к Битриксу.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { getDb } from '@/lib/mongo';
import { postBitrixJson } from '@/lib/bitrix-request';
export const dynamic = 'force-dynamic';

// The Mongo mirror holds full Bitrix task payloads (checklists, group/user objects,
// action maps, etc.). The grid only needs this compact shape; task details are
// fetched when the user opens a card.
function toTaskListItem(task: any) {
  return {
    id: String(task.id ?? task.ID),
    title: task.title || task.TITLE || '',
    description: task.description || task.DESCRIPTION || '',
    status: String(task.status ?? task.STATUS ?? '1'),
    subStatus: String(task.subStatus ?? task.SUB_STATUS ?? ''),
    priority: String(task.priority ?? task.PRIORITY ?? '1'),
    createdDate: task.createdDate || task.CREATED_DATE || '',
    changedDate: task.changedDate || task.CHANGED_DATE || '',
    deadline: task.deadline || task.DEADLINE || undefined,
    timeEstimate: Number(task.timeEstimate ?? task.TIME_ESTIMATE) || 0,
    timeSpentInLogs: Number(task.timeSpentInLogs ?? task.TIME_SPENT_IN_LOGS) || 0,
    groupId: String(task.group?.id || task.groupId || task.GROUP_ID || '0'),
    groupName: task.group?.name || task.groupName || task.GROUP_NAME || '',
    responsibleId: String(task.responsible?.id || task.responsibleId || task.RESPONSIBLE_ID || ''),
    responsibleName: task.responsible?.name || task.responsibleName || task.RESPONSIBLE_NAME || '',
    responsibleIcon: task.responsible?.icon || task.responsibleIcon,
    creatorId: String(task.creator?.id || task.creatorId || task.CREATED_BY || ''),
    creatorName: task.creator?.name || task.creatorName || '',
    commentsCount: Number(task.commentsCount ?? task.COMMENTS_COUNT) || 0,
    parentId: task.parentId || task.PARENT_ID || undefined,
    stageId: task.stageId || task.STAGE_ID || '0',
    chatId: task.chatId || task.CHAT_ID || undefined,
    accompliceIds: (task.accomplices || task.ACCOMPLICES || []).map(String),
    auditorIds: (task.auditors || task.AUDITORS || []).map(String),
  };
}

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) {
    return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  }
  // Если для авторизованного member_id нет ни Bitrix-токена, ни синхронизированных
  // задач — это инвалидированное состояние. Очищаем его и отдаём пустой список,
  // чтобы клиент не видел залежавшиеся данные из старого token.
  const db0 = await getDb();
  const token = await db0
    .collection('user_tokens')
    .findOne({ member_id: memberId }, { projection: { _id: 1, domain: 1, access_token: 1 } });
  if (!token?.access_token || !token.domain) {
    await db0.collection('task_mirror').deleteMany({ member_id: memberId });
    await db0.collection('projects').deleteMany({ member_id: memberId });
    await db0.collection('tasks').deleteMany({ member_id: memberId });
    return NextResponse.json({ tasks: [] });
  }

  const db = await getDb();
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0);
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));

  // task_mirror — полный серверный снимок задач, обновляемый событиями Bitrix24.
  // Не ходим в Bitrix24 из HTTP-ответа: один отсутствующий проект раньше
  // превращал открытие «Все задачи» в десятки запросов и HTTP 500.
  // Merge the durable mirror with fresher background-sync records inside MongoDB.
  // Pagination happens after de-duplication, so the app never transfers the full task set.
  const page = await db
    .collection('task_mirror')
    .aggregate([
      { $match: { member_id: memberId } },
      { $set: { priority: 0 } },
      {
        $unionWith: {
          coll: 'tasks',
          pipeline: [{ $match: { member_id: memberId } }, { $set: { priority: 1 } }],
        },
      },
      { $sort: { id: 1, priority: -1, updated_at: -1 } },
      { $group: { _id: '$id', data: { $first: '$data' } } },
      { $sort: { 'data.changedDate': -1, _id: -1 } },
      {
        $facet: {
          tasks: [{ $skip: offset }, { $limit: limit }, { $replaceWith: '$data' }],
          total: [{ $count: 'value' }],
        },
      },
    ])
    .next();
  const mirroredTasks = page?.tasks || [];
  const total = page?.total?.[0]?.value || 0;

  if (total === 0) {
    const allTasks: any[] = [];
    let start = 0;
    const visited = new Set<number>();
    while (!visited.has(start)) {
      visited.add(start);
      const response = await postBitrixJson(
        `https://${token.domain}/rest/tasks.task.list?auth=${token.access_token}`,
        { order: { ID: 'DESC' }, start },
        true,
      );
      if (response.error) throw new Error(`${response.error}: ${response.error_description}`);
      const tasks = response.result?.tasks || [];
      allTasks.push(...tasks);
      if (response.next === undefined || response.next === null) break;
      start = Number(response.next);
    }
    if (allTasks.length) {
      await db.collection('task_mirror').bulkWrite(
        allTasks.map((task) => ({
          updateOne: {
            filter: { member_id: memberId, id: String(task.id) },
            update: {
              $set: {
                member_id: memberId,
                id: String(task.id),
                data: task,
                updated_at: new Date(),
              },
            },
            upsert: true,
          },
        })),
      );
    }
    return NextResponse.json({
      tasks: allTasks.slice(offset, offset + limit).map(toTaskListItem),
      total: allTasks.length,
      nextOffset: offset + limit < allTasks.length ? offset + limit : null,
    });
  }

  return NextResponse.json({
    tasks: mirroredTasks.map(toTaskListItem),
    total,
    nextOffset: offset + limit < total ? offset + limit : null,
  });
}

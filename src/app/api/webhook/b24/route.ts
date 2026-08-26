import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';

// Bitrix24 шлет события сюда когда что-то меняется
export async function POST(req: NextRequest) {
  const data = await req.json();
  const event = data.event;
  const member_id = data.auth.member_id;

  console.log('[B24 webhook]', event, data);

  const db = await getDb();

  switch (event) {
    case 'ONTASKADD':
    case 'ONTASKUPDATE':
      await handleTaskChange(member_id, data.data);
      break;

    case 'ONTASKDELETE':
      await handleTaskDelete(member_id, data.data);
      break;

    case 'ONCOMMENTADDMESSAGE':
      await handleCommentAdd(member_id, data.data);
      break;
  }

  return NextResponse.json({ status: 'ok' });
}

async function handleTaskChange(memberId: string, taskData: any) {
  const db = await getDb();

  // Сохраняем задачу в MongoDB
  await db.collection('tasks').updateOne(
    { id: taskData.ID, member_id: memberId },
    {
      $set: {
        id: taskData.ID,
        title: taskData.TITLE,
        status: taskData.STATUS,
        groupId: taskData.GROUP_ID,
        member_id: memberId,
        updated_at: new Date(),
        data: taskData,
      },
    },
    { upsert: true },
  );

  // Уведомляем подписчиков через SSE
  await notifySubscribers(memberId, {
    type: 'task_update',
    taskId: taskData.ID,
  });
}

async function handleTaskDelete(memberId: string, taskData: any) {
  const db = await getDb();
  await db.collection('tasks').deleteOne({
    id: taskData.ID,
    member_id: memberId,
  });

  await notifySubscribers(memberId, {
    type: 'task_delete',
    taskId: taskData.ID,
  });
}

async function handleCommentAdd(memberId: string, data: any) {
  const db = await getDb();
  await db.collection('comments').insertOne({
    id: data.ID,
    task_id: data.TASK_ID,
    text: data.TEXT,
    author_id: data.AUTHOR_ID,
    member_id: memberId,
    created_at: new Date(),
  });
}

// SSE: уведомляем всех подписчиков о изменении
async function notifySubscribers(memberId: string, event: any) {
  const db = await getDb();
  await db.collection('events_stream').insertOne({
    member_id: memberId,
    event,
    created_at: new Date(),
  });
}

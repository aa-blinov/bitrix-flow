import { after, NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { invalidateByPrefix } from '@/lib/server-cache';
import { bx24OAuth } from '@/lib/oauth-client';
import { enqueueTaskMirrorSync, processTaskMirrorJobs } from '@/lib/task-mirror';
import { timingSafeEqual } from 'node:crypto';

function setNested(target: Record<string, any>, key: string, value: string) {
  const parts = key.match(/[^\[\]]+/g) || [key];
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else cursor = cursor[part] ||= {};
  });
}

async function payload(req: NextRequest) {
  if ((req.headers.get('content-type') || '').includes('application/json')) return req.json();
  const data: Record<string, any> = {};
  const form = await req.formData();
  form.forEach((value, key) => setNested(data, key, String(value)));
  return data;
}

function eventDetails(event: string, raw: any) {
  const data = raw?.FIELDS_AFTER || raw?.fieldsAfter || raw || {};
  const taskId = String(
    data.TASK_ID || data.taskId || data.ID || data.id || raw?.TASK_ID || raw?.taskId || '',
  );
  const messageId = String(
    data.MESSAGE_ID || data.messageId || raw?.MESSAGE_ID || raw?.messageId || '',
  );
  const title = data.TITLE || data.title || `#${taskId}`;
  if (event === 'ONTASKADD')
    return { type: 'task_added', taskId, title: 'Новая задача', message: title };
  if (event === 'ONTASKDELETE')
    return { type: 'task_deleted', taskId, title: 'Задача удалена', message: title };
  if (event === 'ONTASKCOMMENTADD')
    return {
      type: 'comment_added',
      taskId,
      messageId,
      title: 'Новый комментарий',
      message: raw?.POST_MESSAGE || raw?.MESSAGE || `в задаче ${title}`,
    };
  return { type: 'task_updated', taskId, title: 'Задача обновлена', message: title };
}

async function enrichComment(memberId: string, details: ReturnType<typeof eventDetails>) {
  if (details.type !== 'comment_added' || !details.taskId) return details;
  // The event can arrive just before the chat message becomes visible in REST.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // In the new Bitrix task card comments are chat messages, while the legacy
      // task.commentitem.getlist method returns an empty array.
      const taskResult = await bx24OAuth(memberId, 'tasks.task.get', { taskId: details.taskId });
      const task = taskResult?.task || taskResult;
      const chatId = task?.chatId || task?.CHAT_ID;
      if (!chatId) return details;
      const dialog = await bx24OAuth(memberId, 'im.dialog.messages.get', {
        DIALOG_ID: `chat${chatId}`,
        LIMIT: 10,
      });
      const messages = dialog?.messages || [];
      const message =
        messages.find((item: any) => String(item.id || item.ID) === details.messageId) ||
        messages[0];
      if (message?.text) {
        return {
          ...details,
          title: task?.title ? `Комментарий · ${task.title}` : details.title,
          message: message.text,
        };
      }
    } catch {
      // A history record must still be created if an auxiliary REST call fails.
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return details;
}

async function enrichTaskTitle(memberId: string, details: ReturnType<typeof eventDetails>) {
  if (!details.taskId || details.type === 'task_deleted') return details;
  try {
    const task = await bx24OAuth(memberId, 'tasks.task.get', { taskId: details.taskId });
    const taskTitle = task?.title || task?.TITLE;
    if (!taskTitle) return details;
    const projectId = String(task?.group?.id || task?.groupId || task?.group_id || '');
    return details.type === 'comment_added'
      ? { ...details, title: `Комментарий · ${taskTitle}`, projectId }
      : { ...details, message: taskTitle, projectId };
  } catch {
    return details;
  }
}

// Public Bitrix24 handler: persists a history record then forwards it to SSE.
export async function POST(req: NextRequest) {
  try {
    const body = await payload(req);
    const event = String(body.event || '').toUpperCase();
    const memberId = body.auth?.member_id || body.member_id;
    if (!memberId || !event) return NextResponse.json({ error: 'INVALID_EVENT' }, { status: 400 });

    // Bitrix documents application_token as the way to authenticate event
    // handlers. Do not accept an event solely because it supplies a member id.
    const db = await getDb();
    const stored = await db
      .collection('user_tokens')
      .findOne({ member_id: String(memberId) }, { projection: { application_token: 1 } });
    const receivedToken = String(body.auth?.application_token || '');
    const expectedToken =
      typeof stored?.application_token === 'string' ? stored.application_token : '';
    const validToken =
      receivedToken.length > 0 &&
      expectedToken.length === receivedToken.length &&
      timingSafeEqual(Buffer.from(expectedToken), Buffer.from(receivedToken));
    if (!validToken) return NextResponse.json({ error: 'INVALID_EVENT_AUTH' }, { status: 403 });

    const commentDetails = await enrichComment(memberId, eventDetails(event, body.data));
    const details = await enrichTaskTitle(memberId, commentDetails);
    const now = new Date();
    await db
      .collection('notifications')
      .insertOne({ member_id: memberId, ...details, created_at: now, raw_event: event });
    await db.collection('events_stream').insertOne({
      member_id: memberId,
      event: { ...details, createdAt: now.toISOString() },
      created_at: now,
    });

    invalidateByPrefix(`${memberId}:`);
    await db
      .collection('project_summary_snapshots')
      .updateOne({ member_id: memberId }, { $set: { stale: true, stale_at: now } });
    if (details.taskId) await db.collection('tasks').deleteOne({ id: details.taskId });
    await enqueueTaskMirrorSync(memberId, details.taskId, event);
    // Bitrix receives an acknowledgement immediately. The precise task mirror is
    // updated afterwards, so one event never triggers a portal-wide task scan.
    after(async () => {
      try {
        await processTaskMirrorJobs(memberId);
      } catch (syncError) {
        console.error('Incremental task mirror sync failed', syncError);
      }
    });
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Bitrix event handler failed', error);
    return NextResponse.json({ error: 'HANDLER_FAILED' }, { status: 500 });
  }
}

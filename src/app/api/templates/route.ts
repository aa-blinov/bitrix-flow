import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { normalizeTemplates, replicateFields, type Recurrence } from '@/lib/task-templates';

export const dynamic = 'force-dynamic';

const num = (value: unknown) => (/^\d+$/.test(String(value ?? '')) ? Number(value) : 0);

// Шаблоны личные для автора и тех, кому он их открыл: читаем и пишем токеном человека.
export function GET(req: NextRequest) {
  return withMessenger(req, async (call) => {
    const raw = await call('tasks.template.list', {}, false, true);
    return NextResponse.json({ templates: normalizeTemplates(raw) });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return withMessenger(req, async (call, _memberId, userId) => {
    // Задача из шаблона: в REST нет «создать по шаблону», поэтому копируем поля и чек-лист.
    if (body?.action === 'create-task') {
      const templateId = num(body.templateId);
      const raw = await call('tasks.template.list', {}, false, true);
      const template = normalizeTemplates(raw).find((item) => Number(item.id) === templateId);
      if (!template) return NextResponse.json({ error: 'NO_TEMPLATE' }, { status: 404 });
      const groupId = num(body.projectId) || Number(template.groupId) || 0;
      const added = await call(
        'tasks.task.add',
        {
          fields: {
            TITLE: template.title,
            DESCRIPTION: template.description,
            RESPONSIBLE_ID: Number(template.responsibleId) || Number(userId),
            GROUP_ID: groupId,
            PRIORITY: template.priority,
            ACCOMPLICES: template.accomplices,
            AUDITORS: template.auditors,
            TAGS: template.tags,
            UF_CRM_TASK: template.crm,
          },
        },
        true,
        true,
      );
      const taskId = String(added?.task?.id ?? added?.id ?? '');
      // Пункты чек-листа по одному: повтор POST создал бы дубль, поэтому без гонки адресов.
      const checklist = await call(
        'tasks.template.checklist.list',
        { templateId },
        false,
        true,
      ).catch(() => null);
      const items = (Object.values(checklist?.checkListItems || {}) as any[])
        .map((item) => ({
          title: String(item?.title ?? item?.TITLE ?? ''),
          parent: Number(item?.parentId ?? item?.PARENT_ID ?? 0),
        }))
        .filter((item) => item.title);
      // Корневой пункт это заголовок чек-листа, сами шаги лежат под ним.
      const steps = items.some((item) => item.parent) ? items.filter((item) => item.parent) : items;
      for (const step of steps)
        await call(
          'task.checklistitem.add',
          { TASKID: taskId, 'fields[TITLE]': step.title },
          true,
        ).catch(() => null);
      return NextResponse.json({ taskId });
    }

    if (body?.action === 'save') {
      const title = String(body.title || '')
        .trim()
        .slice(0, 255);
      if (!title) return NextResponse.json({ error: 'EMPTY_TITLE' }, { status: 400 });
      const fields = {
        TITLE: title,
        DESCRIPTION: String(body.description || '').slice(0, 20_000),
        RESPONSIBLE_ID: num(body.responsibleId) || Number(userId),
        GROUP_ID: num(body.groupId),
        ...replicateFields((body.recurrence as Recurrence | null) || null),
      };
      const id = num(body.id);
      if (id) await call('tasks.template.update', { templateId: id, fields }, true, true);
      else
        await call(
          'tasks.template.add',
          { fields: { ...fields, CREATED_BY: Number(userId) } },
          true,
          true,
        );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'BAD_ACTION' }, { status: 400 });
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const templateId = num(body?.id);
  if (!templateId) return NextResponse.json({ error: 'BAD_TEMPLATE' }, { status: 400 });
  return withMessenger(req, async (call) => {
    await call('tasks.template.delete', { templateId }, true, true);
    return NextResponse.json({ ok: true });
  });
}

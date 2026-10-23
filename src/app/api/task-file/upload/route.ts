// Прикрепление файла к задаче: загрузка на диск портала и привязка к задаче.
//
// Сам файл уходит в личную папку пользователя, а привязка к задаче создаёт
// копию в хранилище задачи; исходник после этого удаляется.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { uploadAndAttachTaskFile } from '@/lib/disk-upload';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const taskId = String(form.get('taskId') || '');
  const file = form.get('file');
  if (!/^\d+$/.test(taskId) || !(file instanceof File)) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 413 });
  }

  try {
    const result = await uploadAndAttachTaskFile(memberId, taskId, {
      name: file.name,
      content: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[task-file] attach failed', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'ATTACH_FAILED', detail }, { status: 502 });
  }
}

// Отдаёт вложение из чата задачи. Ссылки, которые im.dialog.messages.get
// возвращает (urlShow/urlDownload), ведут на портал и требуют его cookie —
// в браузере пользователя они отвечают 302 на страницу входа. Поэтому берём
// DOWNLOAD_URL через disk.file.get (он подписан токеном) и стримим сами.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedPerson } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { bx24OAuth } from '@/lib/oauth-client';
import { getBitrixFileStream } from '@/lib/bitrix-request';
import { fileResponse } from '@/lib/file-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Файл скачивается правами самого человека: токеном портала любой перебором id достал бы
  // файлы владельца токена, в том числе его личный диск.
  const person = await getAuthorizedPerson(req.cookies.get(sessionCookie.name)?.value);
  if (!person) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  const { memberId } = person;

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  // Вложения описания задачи адресуются id прикрепления (disk.attachedObject),
  // а файлы из чата — id самого файла на диске. Ссылку с auth-токеном отдают
  // оба метода, поэтому различаем их флагом.
  const method =
    req.nextUrl.searchParams.get('attached') === '1' ? 'disk.attachedObject.get' : 'disk.file.get';
  let downloadUrl: string | undefined;
  let name = 'file';
  try {
    const file = await bx24OAuth(memberId, method, { id }, { asUser: person.userId });
    const result = file?.result || file;
    downloadUrl = result?.DOWNLOAD_URL;
    name = result?.NAME || name;
  } catch (error) {
    console.error(`[task-file] ${method} failed`, error);
    return NextResponse.json({ error: 'FILE_UNAVAILABLE' }, { status: 502 });
  }
  if (!downloadUrl) return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 404 });

  let upstream: Awaited<ReturnType<typeof getBitrixFileStream>>;
  try {
    upstream = await getBitrixFileStream(downloadUrl, req.headers.get('range') || undefined);
  } catch (error) {
    console.error('[task-file] download failed', error);
    return NextResponse.json({ error: 'FILE_UNAVAILABLE' }, { status: 504 });
  }

  return fileResponse(upstream, name, req.nextUrl.searchParams.get('download') === '1');
}

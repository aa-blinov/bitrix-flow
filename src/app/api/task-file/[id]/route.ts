// Отдаёт вложение из чата задачи. Ссылки, которые im.dialog.messages.get
// возвращает (urlShow/urlDownload), ведут на портал и требуют его cookie —
// в браузере пользователя они отвечают 302 на страницу входа. Поэтому берём
// DOWNLOAD_URL через disk.file.get (он подписан токеном) и стримим сами.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { bx24OAuth } from '@/lib/oauth-client';
import { getBitrixFileStream } from '@/lib/bitrix-request';
import { Readable } from 'node:stream';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

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
    const file = await bx24OAuth(memberId, method, { id });
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
    upstream = await getBitrixFileStream(downloadUrl);
  } catch (error) {
    console.error('[task-file] download failed', error);
    return NextResponse.json({ error: 'FILE_UNAVAILABLE' }, { status: 504 });
  }

  const contentType = String(upstream.headers['content-type'] || 'application/octet-stream');
  // Файл приходит с портала и отдаётся с НАШЕГО домена: html или svg, открытые
  // inline, выполнили бы скрипт в контексте приложения. Встраиваем только то,
  // что браузер не исполняет, остальное — вложением.
  const inlineSafe =
    /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|application\/pdf|text\/plain|audio\/|video\/)/i.test(
      contentType,
    );
  const disposition =
    req.nextUrl.searchParams.get('download') === '1' || !inlineSafe ? 'attachment' : 'inline';
  const contentLength = upstream.headers['content-length'];
  return new NextResponse(Readable.toWeb(upstream.stream) as ReadableStream, {
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      // Даже если тип соврал: запрещаем странице с вложением что-либо исполнять.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Файл в Битриксе неизменяем: подписанная ссылка живёт недолго, а сам
      // контент по id не меняется, поэтому кэшируем только в браузере.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

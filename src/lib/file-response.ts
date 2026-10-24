import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import type { getBitrixFileStream } from '@/lib/bitrix-request';

// Файл приходит с портала и отдаётся с НАШЕГО домена: html или svg, открытые
// inline, выполнили бы скрипт в контексте приложения. Встраиваем только то,
// что браузер не исполняет, остальное отдаём вложением.
const INLINE_SAFE =
  /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|application\/pdf|text\/plain|audio\/|video\/)/i;

export function fileResponse(
  upstream: Awaited<ReturnType<typeof getBitrixFileStream>>,
  name: string,
  download: boolean,
): NextResponse {
  const contentType = String(upstream.headers['content-type'] || 'application/octet-stream');
  const disposition = download || !INLINE_SAFE.test(contentType) ? 'attachment' : 'inline';
  const pass = (header: string) => {
    const value = upstream.headers[header];
    return value ? { [header]: String(value) } : {};
  };
  return new NextResponse(Readable.toWeb(upstream.stream) as ReadableStream, {
    // 206, если портал ответил частью файла на Range.
    status: upstream.status === 206 ? 206 : 200,
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      // Даже если тип соврал: запрещаем странице с вложением что-либо исполнять.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ...pass('content-length'),
      ...pass('content-range'),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Файл в Битриксе неизменяем: подписанная ссылка живёт недолго, а сам
      // контент по id не меняется, поэтому кэшируем только в браузере.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getBitrixFileStream } from '@/lib/bitrix-request';
import { fileResponse } from '@/lib/file-response';
import { DIALOG_ID, VOICE_NAME } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';
import { isMockEnabled } from '@/lib/mock-b24';

export const dynamic = 'force-dynamic';

// В UI-тестах портала нет: картинке отдаём прозрачный пиксель, а голосовому сообщению
// 0,1 секунды тишины в WAV. Плеер с битыми данными показал бы ошибку загрузки.
const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
function mockWav() {
  const samples = 800;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples, 40);
  return wav;
}

// Файл чата отдаётся вместе с диалогом: портал проверяет, что пользователь
// состоит в этом чате, и подписывает ссылку токеном. Что файл лежит именно в
// этом диалоге, портал не проверяет: доступ ограничен правами токена, как и у
// /api/task-file.
export function GET(req: NextRequest) {
  const dialogId = req.nextUrl.searchParams.get('dialogId') || '';
  const fileId = req.nextUrl.searchParams.get('fileId') || '';
  if (!DIALOG_ID.test(dialogId) || !/^\d{1,12}$/.test(fileId))
    return Promise.resolve(NextResponse.json({ error: 'BAD_FILE' }, { status: 400 }));
  const name = (req.nextUrl.searchParams.get('name') || 'file').slice(0, 200);
  const download = req.nextUrl.searchParams.get('download') === '1';

  return withMessenger(req, async (call) => {
    if (isMockEnabled())
      return name.startsWith(VOICE_NAME)
        ? new NextResponse(new Uint8Array(mockWav()), { headers: { 'Content-Type': 'audio/wav' } })
        : new NextResponse(new Uint8Array(MOCK_PNG), { headers: { 'Content-Type': 'image/png' } });
    const result = await call(
      'im.v2.File.download',
      { fileId: Number(fileId), dialogId },
      false,
      true,
    );
    const url = String(result?.downloadUrl || '');
    if (!url.startsWith('https://'))
      return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 404 });
    const upstream = await getBitrixFileStream(url, req.headers.get('range') || undefined);
    return fileResponse(upstream, name, download);
  });
}

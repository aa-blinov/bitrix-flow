import { NextRequest, NextResponse } from 'next/server';
import { getBitrixFileStream } from '@/lib/bitrix-request';
import { DIALOG_ID, MAX_FILE_SIZE } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';
import { isMockEnabled } from '@/lib/mock-b24';

export const dynamic = 'force-dynamic';

const MAX_FILES = 5;
const MAX_TEXT = 20_000;

async function readFile(url: string): Promise<Buffer> {
  const upstream = await getBitrixFileStream(url);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of upstream.stream) {
    size += chunk.length;
    if (size > MAX_FILE_SIZE) {
      upstream.stream.destroy();
      throw new Error('FILE_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Пересылка с файлами: REST не умеет пересылать сообщение целиком, поэтому каждый файл
// скачивается из исходного чата и загружается в целевой заново (до 20 МБ каждый). Подпись
// с цитатой уходит с первым файлом. Скачивание идёт через im.v2.File.download, который
// проверяет, что пользователь состоит в исходном чате.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const from = String(body?.fromDialogId || '');
  const to = String(body?.toDialogId || '');
  const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_TEXT) : '';
  const files: { id: number; name: string }[] = Array.isArray(body?.files)
    ? body.files
        .slice(0, MAX_FILES)
        .map((file: any) => ({
          id: Number(file?.id),
          name: String(file?.name || 'file')
            .replace(/[\\/\u0000-\u001f]/g, '_')
            .slice(0, 200),
        }))
        .filter((file: { id: number }) => Number.isInteger(file.id) && file.id > 0)
    : [];
  if (!DIALOG_ID.test(from) || !DIALOG_ID.test(to) || !files.length)
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });

  return withMessenger(req, async (call) => {
    let caption = text;
    for (const file of files) {
      // В UI-тестах портала нет: скачивание подменяет пустой файл, остальной путь настоящий.
      let content = '';
      if (!isMockEnabled()) {
        const link = await call(
          'im.v2.File.download',
          { fileId: file.id, dialogId: from },
          false,
          true,
        );
        const url = String(link?.downloadUrl || '');
        if (!url.startsWith('https://')) throw new Error('FILE_NOT_FOUND');
        content = (await readFile(url)).toString('base64');
      }
      await call(
        'im.v2.File.upload',
        {
          dialogId: to,
          fields: { name: file.name, content, ...(caption ? { message: caption } : {}) },
        },
        true,
        true,
      );
      caption = '';
    }
    return NextResponse.json({ sent: files.length });
  });
}

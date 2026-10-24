import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID, MAX_FILE_SIZE } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

const MAX_CAPTION = 20_000;

const badRequest = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Файл и сообщение с ним создаёт один вызов im.v2.File.upload: отдельным
// im.message.add файл в чат отправить нельзя.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const dialogId = String(form?.get('dialogId') || '');
  const file = form?.get('file');
  const caption = String(form?.get('message') || '').trim();
  if (!DIALOG_ID.test(dialogId)) return badRequest('BAD_DIALOG_ID');
  if (!(file instanceof File) || file.size === 0) return badRequest('BAD_FILE');
  if (file.size > MAX_FILE_SIZE) return badRequest('FILE_TOO_LARGE', 413);
  if (caption.length > MAX_CAPTION) return badRequest('BAD_TEXT');
  // Имя уходит в диск портала: путь и управляющие символы отбрасываем.
  const name = file.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || 'file';
  const content = Buffer.from(await file.arrayBuffer()).toString('base64');

  return withMessenger(req, async (call) => {
    const result = await call(
      'im.v2.File.upload',
      { dialogId, fields: { name, content, ...(caption ? { message: caption } : {}) } },
      true,
      true,
    );
    return NextResponse.json({ id: Number(result?.messageId) || null });
  });
}

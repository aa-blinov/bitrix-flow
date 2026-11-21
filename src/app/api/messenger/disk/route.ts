import { NextRequest, NextResponse } from 'next/server';
import { DIALOG_ID } from '@/lib/messenger';
import { withMessenger } from '@/lib/messenger-api';

export const dynamic = 'force-dynamic';

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

type DiskItem = { id: number; name: string; type: 'folder' | 'file'; size: number };

// Личный Диск человека: папка по номеру, без номера корень его хранилища. Ссылки на
// скачивание (DOWNLOAD_URL) не отдаём: в них зашит токен доступа.
export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('folderId') || '';
  if (raw && !/^\d{1,12}$/.test(raw)) return Promise.resolve(bad('BAD_FOLDER'));
  return withMessenger(req, async (call, _memberId, userId) => {
    let folderId = raw;
    if (!folderId) {
      // JSON: вложенный filter форма не передаёт.
      const storages = await call(
        'disk.storage.getlist',
        { filter: { ENTITY_TYPE: 'user', ENTITY_ID: userId } },
        false,
        true,
      );
      folderId = String(storages?.[0]?.ROOT_OBJECT_ID || '');
      if (!folderId) return NextResponse.json({ error: 'NO_STORAGE' }, { status: 502 });
    }
    // Портал отдаёт папку страницами по 50: «Сохранённые файлы» у Блинова лежали на второй
    // и в окне не появлялись. ponytail: потолок 500 элементов, дальше нужен поиск по Диску.
    const children: Record<string, unknown>[] = [];
    for (let start = 0; start < 500; start += 50) {
      const page = await call('disk.folder.getchildren', { id: folderId, start });
      if (!Array.isArray(page)) break;
      children.push(...page);
      if (page.length < 50) break;
    }
    const items: DiskItem[] = children
      .filter((item) => item?.ID && (item.TYPE === 'folder' || item.TYPE === 'file'))
      .map((item) => ({
        id: Number(item.ID),
        name: String(item.NAME || ''),
        type: item.TYPE as DiskItem['type'],
        size: Number(item.SIZE) || 0,
      }))
      // Папки сверху, дальше по имени: так листают Диск и в самом Битриксе.
      .sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name, 'ru') : a.type === 'folder' ? -1 : 1,
      );
    return NextResponse.json({ folderId: Number(folderId), items });
  });
}

// Файл чата: сохранить к себе на Диск, удалить из чата или отправить в чат файлы с Диска.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const action = String(body?.action || '');
  const fileId = Number(body?.fileId);

  if (action === 'save') {
    if (!Number.isInteger(fileId) || fileId <= 0) return bad('BAD_FILE');
    return withMessenger(req, async (call) => {
      const result = await call('im.disk.file.save', { FILE_ID: fileId }, true);
      if (!result?.file?.id) return NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
      return NextResponse.json({ folder: String(result.folder?.name || '') });
    });
  }
  if (action === 'delete') {
    // CHAT_ID, а не DIALOG_ID: у личного диалога номер диалога это номер человека.
    const chatId = Number(body?.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) return bad('BAD_CHAT');
    if (!Number.isInteger(fileId) || fileId <= 0) return bad('BAD_FILE');
    return withMessenger(req, async (call) => {
      const done = await call('im.disk.file.delete', { CHAT_ID: chatId, FILE_ID: fileId }, true);
      return done
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
    });
  }
  if (action === 'commit') {
    const dialogId = String(body?.dialogId || '');
    const ids = ([...new Set(((body?.fileIds as unknown[]) || []).map(Number))] as number[]).filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (!DIALOG_ID.test(dialogId)) return bad('BAD_DIALOG_ID');
    if (!ids.length || ids.length > 10) return bad('BAD_FILES');
    return withMessenger(req, async (call) => {
      const result = await call(
        'im.disk.file.commit',
        { DIALOG_ID: dialogId, FILE_ID: ids },
        true,
        true,
      );
      // Ответ без файлов: исход неизвестен, повтор дал бы второе сообщение.
      if (!result?.FILES) return NextResponse.json({ error: 'UNKNOWN_RESULT' }, { status: 502 });
      return NextResponse.json({ ok: true });
    });
  }
  return bad('BAD_ACTION');
}

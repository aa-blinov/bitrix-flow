// Прикрепление файла к задаче.
//
// Файлы задачи лежат в хранилище «Загруженные файлы» проекта, а привязка к
// задаче — отдельный вызов REST v3, который ждёт целые числа в
// идентификаторах. Проверено на портале: disk.folder.uploadfile возвращает
// адрес загрузки, после загрузки — id файла, tasks.task.file.attach принимает
// { taskId, fileIds }.
//
// Загружать приходится в стороннюю папку (свою личную), потому что копия
// задачи делается на шаге привязки: исходник после этого удаляется, а в
// хранилище задачи остаётся ровно одна копия файла.

import { getDb } from './mongo';
import { bx24OAuth } from './oauth-client';

const STORAGE_SCAN_LIMIT = 64;
const SCAN_BATCH = 8;

type Storage = {
  ID?: string;
  NAME?: string;
  ENTITY_TYPE?: string;
  ENTITY_ID?: string;
  ROOT_OBJECT_ID?: string;
};

async function bitrixGet(
  domain: string,
  accessToken: string,
  method: string,
  params: Record<string, string>,
  tries = 3,
): Promise<any> {
  const url = `https://${domain}/rest/${method}?auth=${accessToken}`;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
      const text = await response.text();
      if (!text.trim()) continue;
      const data = JSON.parse(text);
      if (data.error) return null;
      return data.result ?? data;
    } catch {
      // портал периодически не отвечает — пробуем ещё раз
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return null;
}

// Личная папка пользователя — туда можно класть файл, который потом
// привязывается к задаче. Идентификатор хранилища пользователя не совпадает
// с его id, поэтому ищем его перебором и запоминаем найденное.
export async function resolveUploadFolder(memberId: string): Promise<string> {
  const db = await getDb();
  const cached = await db.collection('upload_folders').findOne({ member_id: memberId });
  if (cached?.folder_id) return String(cached.folder_id);

  const token = await db.collection('user_tokens').findOne({ member_id: memberId });
  if (!token) throw new Error('Нет токена для пользователя');
  const domain = token.domain || 'eora.bitrix24.ru';

  const current = await bitrixGet(domain, token.access_token, 'user.current', {});
  const userId = String(current?.ID ?? current?.result?.ID ?? '');
  if (!userId) throw new Error('Не удалось определить пользователя портала');

  // Перебор идёт небольшими батчами: портал не любит одновременных
  // запросов и часть из них остаётся без ответа.
  const storages: Storage[] = [];
  for (let start = 1; start <= STORAGE_SCAN_LIMIT; start += SCAN_BATCH) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(SCAN_BATCH, STORAGE_SCAN_LIMIT - start + 1) }, (_, offset) =>
        bitrixGet(domain, token.access_token, 'disk.storage.get', {
          id: String(start + offset),
        }).catch(() => null),
      ),
    );
    storages.push(...(batch.filter(Boolean) as Storage[]));
    const own = storages.find(
      (storage) => storage.ENTITY_TYPE === 'user' && String(storage.ENTITY_ID) === userId,
    );
    if (own) break;
  }
  const own = storages.find(
    (storage) => storage.ENTITY_TYPE === 'user' && String(storage.ENTITY_ID) === userId,
  );
  const folderId = own?.ROOT_OBJECT_ID ? String(own.ROOT_OBJECT_ID) : '';
  if (!folderId) throw new Error('Не найдено личное хранилище пользователя');

  await db
    .collection('upload_folders')
    .updateOne(
      { member_id: memberId },
      { $set: { folder_id: folderId, updated_at: new Date() } },
      { upsert: true },
    );
  return folderId;
}

export async function uploadAndAttachTaskFile(
  memberId: string,
  taskId: string,
  file: { name: string; content: Buffer },
): Promise<{ id: string; name: string; size: number }> {
  const folderId = await resolveUploadFolder(memberId);

  // 1. Адрес загрузки в папке пользователя.
  const upload = await bx24OAuth(memberId, 'disk.folder.uploadfile', {
    id: folderId,
    name: file.name,
    data: file.content.toString('base64'),
  });
  const uploadUrl = upload?.uploadUrl;
  if (!uploadUrl) throw new Error('Портал не выдал адрес загрузки');

  // 2. Сам файл по полученному адресу.
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(file.content)]), file.name);
  const response = await fetch(uploadUrl, { method: 'POST', body });
  const raw = await response.text();
  let uploaded: any = null;
  try {
    uploaded = JSON.parse(raw);
  } catch {
    uploaded = null;
  }
  // Портал отдаёт файл объектом в result: { result: { ID, NAME, ... } }.
  const fileId = String(
    uploaded?.result?.ID ?? uploaded?.result?.id ?? uploaded?.ID ?? uploaded?.id ?? '',
  );
  if (!fileId) {
    const reason = raw ? raw.slice(0, 200) : `статус ${response.status}`;
    throw new Error(`Портал не вернул id файла: ${reason}`);
  }

  // 3. Привязка к задаче: REST v3 принимает только целые числа.
  try {
    await bx24OAuth(
      memberId,
      'tasks.task.file.attach',
      { taskId: Number(taskId), fileIds: [Number(fileId)] },
      { v3: true, json: true },
    );
  } catch (error) {
    await bx24OAuth(memberId, 'disk.file.delete', { id: fileId }).catch(() => {});
    throw error;
  }

  // 4. Исходник удаляем: копия уже лежит в хранилище задачи.
  await bx24OAuth(memberId, 'disk.file.delete', { id: fileId }).catch(() => {});

  return { id: fileId, name: file.name, size: file.content.length };
}

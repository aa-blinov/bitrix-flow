import { bitrixPlainText } from '@/lib/bitrix-markup';
import { parseMessageNodes } from '@/lib/message-markdown';
import { usableAvatar } from '@/lib/utils';

// Нормализация ответов im.* в то, что рисует мессенджер. Сырой ответ портала
// несёт десятки полей чата и пользователя, которые клиенту не нужны.

export type DialogKind = 'user' | 'group' | 'task' | 'chat';

export type Dialog = {
  id: string;
  kind: DialogKind;
  title: string;
  avatar?: string;
  color?: string;
  unread: number;
  /** Задача или проект, к которым привязан чат, для ссылки из шапки. */
  entityId?: string;
  lastMessage?: { id: number; text: string; date: string; authorId: number };
  date: string;
};

export type MessageFile = {
  id: number;
  name: string;
  size: number;
  kind: 'image' | 'audio' | 'video' | 'file';
};

// Вложение-карточка (params.ATTACH): уведомления систем мониторинга, ботов и
// интеграций приходят так, а не текстом.
export type AttachBlock =
  | { type: 'text'; text: string }
  | { type: 'user'; name: string }
  | { type: 'link'; name: string; link: string; desc?: string }
  | { type: 'grid'; rows: { name: string; value: string }[] }
  | { type: 'files'; names: string[] }
  | { type: 'delimiter' };
export type Attach = { description?: string; blocks: AttachBlock[] };

export type Message = {
  id: number;
  authorId: number;
  text: string;
  date: string;
  edited: boolean;
  files: MessageFile[];
  attach: Attach[];
};

/** Кто из участников прочитал диалог и до какого сообщения. */
export type Reader = { id: number; name: string; messageId: number };

export type Person = { id: number; name: string; avatar?: string };

// Допустимый DIALOG_ID: человек это голое число, чат это chat<число>. Всё
// остальное (user12, sg5, произвольная строка) в портал не отправляем.
export const DIALOG_ID = /^(chat)?[1-9]\d{0,11}$/;

function kindOf(item: any): DialogKind {
  if (item.type === 'user') return 'user';
  const entity = String(item.chat?.entity_type || '');
  if (entity === 'SONET_GROUP') return 'group';
  if (/^TASKS/.test(entity)) return 'task';
  return 'chat';
}

// Страницы im.recent.list перекрываются: портал сначала выбирает записи, а потом
// схлопывает их в диалоги, и один диалог может попасть на соседние страницы.
// Свежая версия записи вытесняет старую.
export function mergeDialogs(current: Dialog[], incoming: Dialog[]): Dialog[] {
  const byId = new Map(current.map((dialog) => [dialog.id, dialog]));
  for (const dialog of incoming) byId.set(dialog.id, dialog);
  return [...byId.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// Новые сообщения (FIRST_ID) и более ранние (LAST_ID) приходят отдельными
// запросами и могут пересечься по границе: дубли отсекаются по id.
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// Свои голосовые мы отправляем файлом с этим началом имени: портал не даёт
// REST-приложению выставить признак голосового сообщения, а Chrome пишет звук
// в webm, который портал считает видео. По имени плеер узнаёт запись.
export const VOICE_NAME = 'Голосовое сообщение';

// Потолок вложения: файл идёт через память приложения в base64. Тот же предел
// у загрузки файлов в задачи; proxyClientMaxBodySize в next.config.ts выше него.
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const DIALOGS_PAGE = 50;
// LIMIT метода im.dialog.messages.get: больше 50 портал не отдаёт.
export const MESSAGES_PAGE = 50;

export function normalizeDialogs(result: any): Dialog[] {
  const items: any[] = Array.isArray(result?.items) ? result.items : [];
  return items
    .filter((item) => item?.id && item.type !== 'notify')
    .map((item): Dialog => {
      const kind = kindOf(item);
      const message = item.message;
      return {
        id: String(item.id),
        kind,
        title: String(item.title || item.user?.name || item.chat?.name || 'Без названия'),
        avatar: usableAvatar(kind === 'user' ? item.user?.avatar : item.avatar?.url),
        color: item.avatar?.color || item.user?.color,
        // unread без счётчика значит «отмечен непрочитанным вручную».
        unread: Number(item.counter) || (item.unread ? 1 : 0),
        entityId: item.chat?.entity_id ? String(item.chat.entity_id) : undefined,
        lastMessage: message?.id
          ? {
              id: Number(message.id),
              text:
                bitrixPlainText(String(message.text || ''), parseMessageNodes) ||
                (message.file ? 'Файл' : message.attach ? 'Вложение' : ''),
              date: String(message.date || ''),
              authorId: Number(message.author_id) || 0,
            }
          : undefined,
        date: String(item.date_last_activity || item.date_update || message?.date || ''),
      };
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function fileKind(file: any): MessageFile['kind'] {
  if (file.isVoiceNote || String(file.name || '').startsWith(VOICE_NAME)) return 'audio';
  return ['image', 'audio', 'video'].includes(file.type) ? file.type : 'file';
}

function normalizeAttach(raw: any): Attach[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item): Attach => {
    const blocks: AttachBlock[] = [];
    for (const block of Array.isArray(item?.BLOCKS) ? item.BLOCKS : []) {
      if (block.MESSAGE) blocks.push({ type: 'text', text: String(block.MESSAGE) });
      else if (block.USER?.NAME) blocks.push({ type: 'user', name: String(block.USER.NAME) });
      else if (block.LINK?.LINK)
        blocks.push({
          type: 'link',
          name: String(block.LINK.NAME || block.LINK.LINK),
          link: String(block.LINK.LINK),
          desc: block.LINK.DESC ? String(block.LINK.DESC) : undefined,
        });
      else if (Array.isArray(block.GRID))
        blocks.push({
          type: 'grid',
          rows: block.GRID.map((cell: any) => ({
            name: String(cell.NAME || ''),
            value: String(cell.VALUE || ''),
          })),
        });
      else if (Array.isArray(block.FILE) || Array.isArray(block.IMAGE))
        blocks.push({
          type: 'files',
          names: [...(block.FILE || []), ...(block.IMAGE || [])].map((f: any) =>
            String(f.NAME || f.LINK || ''),
          ),
        });
      else if (block.DELIMITER) blocks.push({ type: 'delimiter' });
    }
    return { description: item?.DESCRIPTION ? String(item.DESCRIPTION) : undefined, blocks };
  });
}

export function normalizeMessages(result: any): {
  messages: Message[];
  people: Record<string, Person>;
} {
  const raw: any[] = Array.isArray(result?.messages) ? result.messages : [];
  const people: Record<string, Person> = {};
  for (const user of Array.isArray(result?.users) ? result.users : []) {
    people[String(user.id)] = {
      id: Number(user.id),
      name: String(user.name || ''),
      avatar: usableAvatar(user.avatar),
    };
  }
  const files = new Map<number, MessageFile>();
  for (const file of Array.isArray(result?.files) ? result.files : []) {
    files.set(Number(file.id), {
      id: Number(file.id),
      name: String(file.name || 'Файл'),
      size: Number(file.size) || 0,
      kind: fileKind(file),
    });
  }
  return {
    // Портал отдаёт новые сообщения первыми, а читают сверху вниз.
    messages: raw
      .map((m): Message => ({
        id: Number(m.id),
        authorId: Number(m.author_id) || 0,
        text: String(m.text || ''),
        date: String(m.date || ''),
        edited: m.params?.IS_EDITED === 'Y',
        // params приходит пустым массивом, а не объектом, если параметров нет.
        files: ((m.params?.FILE_ID as unknown[]) || [])
          .map((id) => files.get(Number(id)))
          .filter((file): file is MessageFile => Boolean(file)),
        attach: normalizeAttach(m.params?.ATTACH),
      }))
      .sort((a, b) => a.id - b.id),
    people,
  };
}

// readed_list из im.dialog.get: у каждого участника id последнего прочитанного
// им сообщения. Поля нет в документации метода, но портал отдаёт его всегда.
export function normalizeReaders(result: any, me: number): Reader[] {
  const list: any[] = Array.isArray(result?.readed_list) ? result.readed_list : [];
  return list
    .filter((entry) => Number(entry.user_id) !== me && Number(entry.message_id) > 0)
    .map((entry) => ({
      id: Number(entry.user_id),
      name: String(entry.user_name || ''),
      messageId: Number(entry.message_id),
    }));
}

/** Участники, прочитавшие сообщение: те, чей последний прочитанный не раньше него. */
export function readersOf(message: Message, readers: Reader[]): Reader[] {
  return readers.filter((reader) => reader.messageId >= message.id);
}

// Файл отдаёт наш роут, а не ссылка портала: та без cookie портала ведёт на вход.
export function fileUrl(dialogId: string, file: MessageFile, download = false): string {
  return `/api/messenger/file?dialogId=${encodeURIComponent(dialogId)}&fileId=${file.id}&name=${encodeURIComponent(file.name)}${download ? '&download=1' : ''}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

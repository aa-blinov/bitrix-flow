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

export type Message = {
  id: number;
  authorId: number;
  text: string;
  date: string;
};

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
              text: String(message.text || (message.file ? '[Файл]' : '')),
              date: String(message.date || ''),
              authorId: Number(message.author_id) || 0,
            }
          : undefined,
        date: String(item.date_last_activity || item.date_update || message?.date || ''),
      };
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
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
  return {
    // Портал отдаёт новые сообщения первыми, а читают сверху вниз.
    messages: raw
      .map((m): Message => ({
        id: Number(m.id),
        authorId: Number(m.author_id) || 0,
        text: String(m.text || ''),
        date: String(m.date || ''),
      }))
      .sort((a, b) => a.id - b.id),
    people,
  };
}

import { bitrixPlainText } from '@/lib/bitrix-markup';
import { parseMessageNodes } from '@/lib/message-markdown';
import { usableAvatar } from '@/lib/utils';
import { dateFormat, relativeFormat, t } from '@/lib/i18n';

// Нормализация ответов im.* в то, что рисует мессенджер. Сырой ответ портала
// несёт десятки полей чата и пользователя, которые клиенту не нужны.

// status у пользователя Битрикса это выбранный им статус (online, dnd, away, break), а не
// присутствие: «online» стоит у всех, кто его не менял. Реально в сети тот, у кого свежая
// активность (веб, телефон или приложение); статус и метки «отошёл» уточняют, чем он занят.
const ONLINE_WINDOW_MS = 5 * 60_000;

export type PresenceState = 'online' | 'busy' | 'away' | 'offline';
export type Presence = { state: PresenceState; lastSeen?: number; female?: boolean };

export function presenceOf(user: any, now = Date.now()): Presence {
  const seen = [user?.last_activity_date, user?.mobile_last_date, user?.desktop_last_date]
    .map((value) => (value ? Date.parse(String(value)) : 0))
    .filter((time) => Number.isFinite(time) && time > 0);
  const lastSeen = seen.length ? Math.max(...seen) : undefined;
  const female = user?.gender === 'F';
  if (!user || !lastSeen || lastSeen <= now - ONLINE_WINDOW_MS)
    return { state: 'offline', lastSeen, female };
  if (user.status === 'dnd') return { state: 'busy', lastSeen, female };
  if (user.idle || user.absent || user.status !== 'online')
    return { state: 'away', lastSeen, female };
  return { state: 'online', lastSeen, female };
}

const AGO = relativeFormat({ numeric: 'always' });
const SEEN_DAY = dateFormat({ day: 'numeric', month: 'short' });
const SEEN_TIME = dateFormat({ hour: '2-digit', minute: '2-digit' });

/** Подпись под именем: «в сети», «не беспокоить», «отошёл» или когда был в последний раз. */
export function presenceText(presence: Presence | undefined, now = Date.now()): string {
  if (!presence) return '';
  if (presence.state === 'online') return t('в сети');
  if (presence.state === 'busy') return t('не беспокоить');
  if (presence.state === 'away') return presence.female ? t('отошла') : t('отошёл');
  if (!presence.lastSeen) return '';
  const verb = presence.female ? t('Была') : t('Был');
  const minutes = Math.max(1, Math.round((now - presence.lastSeen) / 60_000));
  if (minutes < 60) return t('{0} в сети {1}', verb, AGO.format(-minutes, 'minute'));
  if (minutes < 24 * 60)
    return t('{0} в сети {1}', verb, AGO.format(-Math.round(minutes / 60), 'hour'));
  const seen = new Date(presence.lastSeen);
  const yesterday = new Date(now - 24 * 3_600_000);
  return seen.toDateString() === yesterday.toDateString()
    ? t('{0} в сети вчера в {1}', verb, SEEN_TIME.format(seen))
    : t('{0} в сети {1}', verb, SEEN_DAY.format(seen));
}

export type DialogKind = 'user' | 'group' | 'task' | 'channel' | 'chat';

export type Dialog = {
  id: string;
  kind: DialogKind;
  title: string;
  avatar?: string;
  color?: string;
  unread: number;
  /** Номер чата для методов портала, которым нужен CHAT_ID. */
  chatId?: number;
  pinned?: boolean;
  /** Звук отключён: уведомления о сообщениях не показываем. */
  muted?: boolean;
  /** Присутствие собеседника (только личные диалоги). */
  presence?: Presence;
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
  /** Кто поставил лайк: params.LIKE, список id пользователей. */
  likes: number[];
  files: MessageFile[];
  attach: Attach[];
};

/** Кто из участников прочитал диалог и до какого сообщения. */
export type Reader = { id: number; name: string; messageId: number };

export type Person = { id: number; name: string; avatar?: string; presence?: Presence };

// Допустимый DIALOG_ID: человек это голое число, чат это chat<число>. Всё
// остальное (user12, sg5, произвольная строка) в портал не отправляем.
export const MESSAGE_ID = /^[1-9]\d{0,11}$/;

export const DIALOG_ID = /^(chat)?[1-9]\d{0,11}$/;

function kindOf(item: any): DialogKind {
  if (item.type === 'user') return 'user';
  const entity = String(item.chat?.entity_type || '');
  // Каналы Битрикса: channel, openChannel и общий канал компании generalChannel.
  if (/channel$/i.test(String(item.chat?.type || ''))) return 'channel';
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
  // Закреплённые наверху, как в самом Битриксе, внутри групп по свежести.
  return [...byId.values()].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      Date.parse(b.date) - Date.parse(a.date),
  );
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

export function normalizeDialogs(result: any, me = 0): Dialog[] {
  const items: any[] = Array.isArray(result?.items) ? result.items : [];
  return items
    .filter((item) => item?.id && item.type !== 'notify')
    .map((item): Dialog => {
      const kind = kindOf(item);
      const message = item.message;
      return {
        id: String(item.id),
        kind,
        title: String(item.title || item.user?.name || item.chat?.name || t('Без названия')),
        avatar: usableAvatar(kind === 'user' ? item.user?.avatar : item.avatar?.url),
        color: item.avatar?.color || item.user?.color,
        // unread без счётчика значит «отмечен непрочитанным вручную».
        unread: Number(item.counter) || (item.unread ? 1 : 0),
        chatId: Number(item.chat_id) || undefined,
        pinned: Boolean(item.pinned),
        // mute_list приходит объектом {userId: true} или списком id.
        muted:
          me > 0 &&
          (Array.isArray(item.chat?.mute_list)
            ? item.chat.mute_list.map(Number).includes(me)
            : Boolean(item.chat?.mute_list?.[me])),
        presence: kind === 'user' ? presenceOf(item.user) : undefined,
        entityId: item.chat?.entity_id ? String(item.chat.entity_id) : undefined,
        lastMessage: message?.id
          ? {
              id: Number(message.id),
              text:
                bitrixPlainText(String(message.text || ''), parseMessageNodes) ||
                (message.file ? t('Файл') : message.attach ? t('Вложение') : ''),
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
      presence: presenceOf(user),
    };
  }
  const files = new Map<number, MessageFile>();
  for (const file of Array.isArray(result?.files) ? result.files : []) {
    files.set(Number(file.id), {
      id: Number(file.id),
      name: String(file.name || t('Файл')),
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
        likes: Array.isArray(m.params?.LIKE) ? m.params.LIKE.map(Number) : [],
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
  if (bytes < 1024) return t('{0} Б', bytes);
  if (bytes < 1024 * 1024) return t('{0} КБ', Math.round(bytes / 1024));
  return t('{0} МБ', (bytes / 1024 / 1024).toFixed(1));
}

export type UserHit = {
  id: number;
  name: string;
  position?: string;
  avatar?: string;
  presence: Presence;
};

// im.search.user.list отдаёт объект по id, im.dialog.users.list массив: оба вида
// приводятся к одному списку, боты и отключённые пользователи отсеиваются.
export function normalizeUsers(result: any): UserHit[] {
  const list: any[] = Array.isArray(result) ? result : Object.values(result || {});
  return list
    .filter((user) => user?.id && !user.bot && user.active !== false)
    .map((user) => ({
      id: Number(user.id),
      name: String(user.name || ''),
      position: user.work_position ? String(user.work_position) : undefined,
      avatar: usableAvatar(user.avatar),
      presence: presenceOf(user),
    }));
}

// REST не возвращает связь «ответ на сообщение» (REPLY_ID приходит пустым в
// params), поэтому ответ и пересылка уходят цитатой в тексте: она одинаково
// читается и у нас, и в самом Битриксе.
export function quoteBlock(
  author: string,
  message: Pick<Message, 'text' | 'files'>,
  label = '',
): string {
  const plain = bitrixPlainText(message.text, parseMessageNodes)
    .replace(/\[\/?quote\]/gi, '')
    .slice(0, 300);
  const snippet = plain || message.files.map((file) => file.name).join(', ') || 'Сообщение';
  return `[QUOTE]${label}${author}: ${snippet}[/QUOTE]\n`;
}

// В поле ввода упоминание выглядит как @Имя, а в тег Битрикса превращается при отправке.
export function applyMentions(
  text: string,
  mentions: { id: number | 'all'; name: string }[],
): string {
  return mentions.reduce(
    (result, mention) =>
      result.replace(`@${mention.name}`, `[USER=${mention.id}]${mention.name}[/USER]`),
    text,
  );
}

const POST_RANK: Record<string, number> = { member: 1, manager: 2, owner: 3 };

// В канале писать могут не все: правило лежит в permissions.canPost, роль
// пользователя в role. Если чего-то из этого нет, решает сам портал при отправке.
export function canPostIn(dialog: any): boolean {
  const need = POST_RANK[String(dialog?.permissions?.canPost || '')];
  const have = POST_RANK[String(dialog?.role || '')];
  return !need || !have || have >= need;
}

// Сведения об одном диалоге из im.dialog.get: нужны, когда диалог открыт по адресу
// страницы, а в первой странице списка его нет.
export function normalizeDialogInfo(result: any, id: string): Dialog | null {
  if (!result?.id) return null;
  const entity = String(result.entity_type || '');
  const type = String(result.type || '');
  const kind: DialogKind =
    type === 'private'
      ? 'user'
      : /channel$/i.test(type)
        ? 'channel'
        : entity === 'SONET_GROUP'
          ? 'group'
          : /^TASKS/.test(entity)
            ? 'task'
            : 'chat';
  return {
    id,
    kind,
    title: String(result.name || t('Без названия')),
    avatar: usableAvatar(result.avatar),
    chatId: Number(result.id) || undefined,
    entityId: result.entity_id ? String(result.entity_id) : undefined,
    unread: Number(result.counter) || 0,
    date: String(result.date_create || new Date().toISOString()),
  };
}

// Результат im.search.chat.list: чаты по названию, в том числе давно не писавшие.
export function normalizeChatHits(result: any): Dialog[] {
  const list: any[] = Array.isArray(result) ? result : [];
  return list
    .filter((chat) => chat?.id)
    .map((chat): Dialog => {
      const type = String(chat.type || '');
      const entity = String(chat.entity_type || '');
      const kind: DialogKind = /channel$/i.test(type)
        ? 'channel'
        : type === 'sonetGroup' || entity === 'SONET_GROUP'
          ? 'group'
          : /^TASKS/.test(entity)
            ? 'task'
            : 'chat';
      return {
        id: `chat${Number(chat.id)}`,
        kind,
        title: String(chat.name || t('Без названия')),
        avatar: usableAvatar(chat.avatar),
        chatId: Number(chat.id),
        entityId: chat.entity_id ? String(chat.entity_id) : undefined,
        unread: 0,
        date: String(chat.date_create || '1970-01-01T00:00:00Z'),
      };
    });
}

// Сбои портала, у которых есть понятная причина и понятное действие. Остальное остаётся
// общим «не удалось загрузить»: догадка в тексте ошибки хуже честного «не знаем».
export function portalErrorHint(message: unknown): string | null {
  const text = String(message || '');
  if (/дисковый ресурс|disk (space|quota)/i.test(text))
    return t(
      'Портал Битрикс24 отклоняет все запросы: на нём закончилось место на диске. Нужно освободить место или расширить тариф.',
    );
  if (/expired_token|invalid_token|NO_AUTH/i.test(text))
    return t('Доступ приложения к порталу истёк. Откройте приложение из Битрикс24 заново.');
  return null;
}

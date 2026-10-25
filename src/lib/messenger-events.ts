// События мессенджера для браузеров. Обычному приложению портал шлёт их не
// push-ом, а через im.v2.Event.get: подписка пользователя, потом разбор очереди
// с подтверждением по offset. Здесь один серверный поллер на всех: он читает очередь
// и кладёт события в events_stream, откуда их уже раздаёт общий SSE /api/events.

import { bitrixPlainText } from './bitrix-markup';
import { getProtectedMemberId } from './authorized-member';
import { parseMessageNodes } from './message-markdown';
import { getDb } from './mongo';
import { bx24OAuth } from './oauth-client';

export type MessengerEvent = {
  type: 'messenger';
  kind: 'add' | 'update' | 'delete' | 'reaction' | 'join';
  dialogId: string;
  chatId: number;
  messageId: number;
  authorId: number;
  author: string;
  chat: string;
  text: string;
  /** Звук в чате отключён: уведомление показывать не нужно. */
  muted: boolean;
  at: string;
};

const KINDS: Record<string, MessengerEvent['kind']> = {
  ONIMV2MESSAGEADD: 'add',
  ONIMV2MESSAGEUPDATE: 'update',
  ONIMV2MESSAGEDELETE: 'delete',
  ONIMV2REACTIONCHANGE: 'reaction',
  ONIMV2JOINCHAT: 'join',
};

export function mapEvent(raw: any, mutedChats: Set<number> = new Set()): MessengerEvent | null {
  const kind = KINDS[String(raw?.type)];
  const data = raw?.data;
  if (!kind || !data?.chat) return null;
  const message = data.message || {};
  const chatId = Number(data.chat.id) || 0;
  const hasFile = Array.isArray(message.params?.FILE_ID) && message.params.FILE_ID.length > 0;
  return {
    type: 'messenger',
    kind,
    dialogId: String(data.chat.dialogId || ''),
    chatId,
    // Для удаления портал отдаёт голый messageId, без объекта сообщения.
    messageId: Number(message.id ?? data.messageId) || 0,
    authorId: Number(message.authorId ?? message.author_id) || 0,
    author: String(data.user?.name || ''),
    chat: String(data.chat.name || ''),
    text:
      bitrixPlainText(String(message.text || ''), parseMessageNodes).slice(0, 200) ||
      (hasFile ? 'Файл' : ''),
    muted: mutedChats.has(chatId),
    at: String(raw.date || new Date().toISOString()),
  };
}

const POLL_MS = 3_000;
// Без открытых вкладок очередь не читаем, а подписку снимаем: иначе портал копил бы
// события до суток. Клиент при подключении всё равно загружает диалоги заново.
const IDLE_UNSUBSCRIBE_MS = 90_000;
// После перезапуска очередь отдаёт и старые события: уведомлять о них поздно.
const MAX_AGE_MS = 2 * 60_000;
const MUTE_REFRESH_MS = 5 * 60_000;

type State = {
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  subscribed: boolean;
  offset: number;
  lastActive: number;
  lastOkAt: number;
  lastError: string;
  me: number;
  mutedChats: Set<number>;
  mutedAt: number;
  seen: string[];
};

declare global {
  // eslint-disable-next-line no-var
  var __messengerEvents: State | undefined;
  // eslint-disable-next-line no-var
  var __sseSubscribers: Set<unknown> | undefined;
}

function getState(): State {
  return (globalThis.__messengerEvents ??= {
    timer: null,
    inFlight: false,
    subscribed: false,
    offset: 0,
    lastActive: 0,
    lastOkAt: 0,
    lastError: '',
    me: 0,
    mutedChats: new Set(),
    mutedAt: 0,
    seen: [],
  });
}

// Портал присылает каждое событие дважды (по одному на каждую копию сообщения),
// поэтому повтор по виду и номеру сообщения отбрасываем.
function isDuplicate(state: State, event: MessengerEvent) {
  const key = `${event.kind}:${event.messageId}:${event.dialogId}`;
  if (state.seen.includes(key)) return true;
  state.seen.push(key);
  if (state.seen.length > 300) state.seen.shift();
  return false;
}

async function refreshMuted(memberId: string, state: State) {
  if (Date.now() - state.mutedAt < MUTE_REFRESH_MS) return;
  state.mutedAt = Date.now();
  try {
    const result = await bx24OAuth(
      memberId,
      'im.recent.list',
      { SKIP_OPENLINES: 'Y', LIMIT: '200' },
      { parallel: true },
    );
    const muted = new Set<number>();
    for (const item of result?.items || []) {
      const list = item.chat?.mute_list;
      const mine = Array.isArray(list)
        ? list.map(Number).includes(state.me)
        : Boolean(list?.[state.me]);
      if (mine && Number(item.chat_id)) muted.add(Number(item.chat_id));
    }
    state.mutedChats = muted;
  } catch {
    // Список отключённых чатов обновится в следующий раз.
  }
}

async function tick() {
  const state = getState();
  if (state.inFlight) return;
  const clients = globalThis.__sseSubscribers?.size ?? 0;
  if (!clients) {
    if (state.subscribed && Date.now() - state.lastActive > IDLE_UNSUBSCRIBE_MS) {
      state.subscribed = false;
      state.offset = 0;
      const memberId = await getProtectedMemberId().catch(() => null);
      if (memberId)
        await bx24OAuth(memberId, 'im.v2.Event.unsubscribe', {}, { json: true }).catch(() => {});
    }
    return;
  }
  state.lastActive = Date.now();
  state.inFlight = true;
  try {
    const memberId = await getProtectedMemberId();
    if (!memberId) return;
    if (!state.subscribed) {
      await bx24OAuth(memberId, 'im.v2.Event.subscribe', {}, { json: true });
      const me = await bx24OAuth(memberId, 'user.current', {}, { parallel: true });
      state.me = Number(me?.ID) || 0;
      state.subscribed = true;
    }
    await refreshMuted(memberId, state);

    const db = await getDb();
    for (let page = 0; page < 5; page++) {
      const result = await bx24OAuth(
        memberId,
        'im.v2.Event.get',
        { limit: 100, ...(state.offset ? { offset: state.offset } : {}) },
        { json: true },
      );
      // Повторный запрос с offset подтверждает прочитанное и удаляет события на портале.
      if (Number(result?.nextOffset)) state.offset = Number(result.nextOffset);
      const docs = [];
      for (const raw of result?.events || []) {
        const event = mapEvent(raw, state.mutedChats);
        if (!event || isDuplicate(state, event)) continue;
        if (Date.now() - Date.parse(event.at) > MAX_AGE_MS) continue;
        docs.push({ member_id: memberId, event, created_at: new Date() });
      }
      if (docs.length) await db.collection('events_stream').insertMany(docs);
      if (!result?.hasMore) break;
    }
    state.lastOkAt = Date.now();
    state.lastError = '';
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.warn('[messenger-events]', state.lastError);
  } finally {
    state.inFlight = false;
  }
}

// Для /api/health: опрос живой, если есть открытые вкладки и последний проход был недавно.
export function getMessengerEventsHealth() {
  const { lastOkAt, lastError, subscribed } = getState();
  return {
    active: subscribed && (globalThis.__sseSubscribers?.size ?? 0) > 0,
    lastOkAt,
    lastError,
  };
}

export function startMessengerEvents() {
  // В mock-режиме портала нет, а UI-тесты событий не ждут.
  if (process.env.MOCK_B24 === '1') return;
  const state = getState();
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), POLL_MS);
}

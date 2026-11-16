// События мессенджера для браузеров. Обычному приложению портал шлёт их не
// push-ом, а через im.v2.Event.get: подписка пользователя, потом разбор очереди
// с подтверждением по offset. Здесь один серверный поллер на всех: он читает очередь
// и кладёт события в events_stream, откуда их уже раздаёт общий SSE /api/events.

import { bitrixPlainText } from './bitrix-markup';
import { getProtectedMemberId } from './authorized-member';
import { parseMessageNodes } from './message-markdown';
import { getDb } from './mongo';
import { bx24OAuth } from './oauth-client';
import { mentionsUser, pingText } from './ping';
import { hasSubscriptions, pushConfigured, sendPush } from './push';

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
  /** Меня упомянули тегом [USER=…]: пинг приходит даже из чата с отключённым звуком. */
  mentioned: boolean;
  at: string;
  /** Моё сообщение: о нём не звенят. Сервер знает свой id, вкладке он может быть неизвестен. */
  own?: boolean;
  /** Событие старше пары минут: данные обновить, но не звенеть. */
  stale?: boolean;
};

const KINDS: Record<string, MessengerEvent['kind']> = {
  ONIMV2MESSAGEADD: 'add',
  ONIMV2MESSAGEUPDATE: 'update',
  ONIMV2MESSAGEDELETE: 'delete',
  ONIMV2REACTIONCHANGE: 'reaction',
  ONIMV2JOINCHAT: 'join',
};

export function mapEvent(
  raw: any,
  mutedChats: Set<number> = new Set(),
  me = 0,
): MessengerEvent | null {
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
    mentioned: mentionsUser(String(message.text || ''), me),
    own: Boolean(me) && Number(message.authorId ?? message.author_id) === me,
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
  /** Первая попытка чтения после подписки или простоя: от неё health отсчитывает сбой. */
  startedAt: number;
  lastError: string;
  me: number;
  mutedChats: Set<number>;
  mutedAt: number;
  mutedGeneration: number;
  seen: string[];
  /** Есть подписки на пуши: очередь читаем и без открытых вкладок. */
  pushWanted: boolean;
  pushCheckedAt: number;
  pushGeneration: number;
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
    startedAt: 0,
    lastError: '',
    me: 0,
    mutedChats: new Set(),
    mutedAt: 0,
    mutedGeneration: 0,
    seen: [],
    pushWanted: false,
    pushCheckedAt: 0,
    pushGeneration: 0,
  });
}

// Портал присылает каждое событие дважды (по одному на каждую копию сообщения),
// поэтому повтор нового сообщения отбрасываем: он звенел бы дважды. Правку и реакцию
// не схлопываем: вторая правка того же сообщения это новое событие, а лишний повтор
// стоит только перечитывания страницы.
function dedupKey(event: MessengerEvent) {
  return event.kind === 'add' ? `add:${event.messageId}:${event.dialogId}` : null;
}

function remember(state: State, keys: string[]) {
  state.seen.push(...keys);
  if (state.seen.length > 300) state.seen.splice(0, state.seen.length - 300);
}

async function refreshMuted(memberId: string, state: State) {
  if (Date.now() - state.mutedAt < MUTE_REFRESH_MS) return;
  // Сбой запроса не делает пустой список актуальным на пять минут: повтор через 15 с.
  state.mutedAt = Date.now() - MUTE_REFRESH_MS + 15_000;
  // Звук переключили, пока шёл запрос: его ответ уже устарел, ждём следующий проход.
  const generation = state.mutedGeneration;
  try {
    // Заглушённый чат может стоять дальше первой страницы: смотрим до пяти страниц.
    const items: any[] = [];
    for (let page = 0; page < 5; page++) {
      const result = await bx24OAuth(
        memberId,
        'im.recent.list',
        { SKIP_OPENLINES: 'Y', LIMIT: '200', OFFSET: String(page * 200) },
        { parallel: true },
      );
      // Ответ без списка не значит «заглушённых нет»: прежний кэш остаётся.
      if (!Array.isArray(result?.items)) throw new Error('BAD_RECENT_LIST');
      items.push(...result.items);
      if (!(result?.hasMore ?? result?.hasMorePages)) break;
    }
    const muted = new Set<number>();
    for (const item of items) {
      const list = item.chat?.mute_list;
      const mine = Array.isArray(list)
        ? list.map(Number).includes(state.me)
        : Boolean(list?.[state.me]);
      if (mine && Number(item.chat_id)) muted.add(Number(item.chat_id));
    }
    if (generation !== state.mutedGeneration) return;
    state.mutedChats = muted;
    state.mutedAt = Date.now();
  } catch {
    // Список отключённых чатов обновится в следующий раз.
  }
}

const PUSH_CHECK_MS = 60_000;

async function refreshPushWanted(state: State) {
  if (!pushConfigured() || Date.now() - state.pushCheckedAt < PUSH_CHECK_MS) return;
  state.pushCheckedAt = Date.now();
  // Подписку добавили, пока шла проверка: её ответ устарел, кэш сброшен и перечитается.
  const generation = state.pushGeneration;
  // Сбой базы не равен «подписок нет»: остаётся прежнее значение, повтор через 10 с.
  try {
    const memberId = await getProtectedMemberId();
    const wanted = memberId ? await hasSubscriptions(memberId) : false;
    if (generation === state.pushGeneration) state.pushWanted = wanted;
  } catch (error) {
    if (generation === state.pushGeneration)
      state.pushCheckedAt = Date.now() - PUSH_CHECK_MS + 10_000;
    console.warn('[messenger-events] проверка пуш-подписок', error);
  }
}

// Проход занимает флаг до первого await и держит его до конца: иначе медленная проверка
// пушей пропускала второй тик, два чтения шли с одним offset, а поздняя отписка снимала
// подписку, которую следующий тик уже успел оформить заново.
async function tick() {
  const state = getState();
  if (state.inFlight) return;
  state.inFlight = true;
  try {
    await poll(state);
  } finally {
    state.inFlight = false;
  }
}

async function poll(state: State) {
  const clients = globalThis.__sseSubscribers?.size ?? 0;
  // Отсчёт для health до первого await: зависшая проверка пушей тоже должна быть видна.
  if (clients && Date.now() - state.lastActive > IDLE_UNSUBSCRIBE_MS) state.startedAt = Date.now();
  await refreshPushWanted(state);
  if (!clients && !state.pushWanted) {
    // Вкладка могла подключиться, пока проверяли пуши: перед отпиской смотрим заново.
    const now = globalThis.__sseSubscribers?.size ?? 0;
    if (!now && state.subscribed && Date.now() - state.lastActive > IDLE_UNSUBSCRIBE_MS) {
      const memberId = await getProtectedMemberId().catch(() => null);
      if (memberId)
        await bx24OAuth(memberId, 'im.v2.Event.unsubscribe', {}, { json: true }).catch(() => {});
      state.subscribed = false;
      state.offset = 0;
    }
    return;
  }
  // Простой кончился: отсчёт для health начинается заново, а не с прошлого успеха.
  if (Date.now() - state.lastActive > IDLE_UNSUBSCRIBE_MS) state.startedAt = Date.now();
  state.lastActive = Date.now();
  try {
    const memberId = await getProtectedMemberId();
    if (!memberId) return;
    if (!state.subscribed) {
      await bx24OAuth(memberId, 'im.v2.Event.subscribe', {}, { json: true });
      const me = await bx24OAuth(memberId, 'user.current', {}, { parallel: true });
      // Без своего id нельзя отличить свои сообщения и заглушённые чаты: проход не готов.
      if (!(Number(me?.ID) > 0)) throw new Error('BAD_CURRENT_USER');
      state.me = Number(me.ID);
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
      // Ответ без массива событий не пустая страница: подтверждать его offset нельзя.
      if (!Array.isArray(result?.events)) throw new Error('BAD_EVENT_PAGE');
      const docs = [];
      const keys: string[] = [];
      for (const raw of result?.events || []) {
        const event = mapEvent(raw, state.mutedChats, state.me);
        if (!event) continue;
        const key = dedupKey(event);
        if (key && (state.seen.includes(key) || keys.includes(key))) continue;
        if (key) keys.push(key);
        // Старое событие (после сбоя или перезапуска) всё равно раздаём: вкладки по нему
        // обновят данные. Не звенят о нём и не шлют пуш.
        if (Date.now() - Date.parse(event.at) > MAX_AGE_MS) event.stale = true;
        docs.push({ member_id: memberId, event, created_at: new Date() });
      }
      // Сначала запись, потом подтверждение: следующий запрос с offset удаляет события на
      // портале, и при сбое записи страница пропала бы. Без нового offset портал отдаст
      // её снова, а повтор отсечёт seen.
      const insertedAt = Date.now();
      if (docs.length) await db.collection('events_stream').insertMany(docs);
      remember(state, keys);
      if (Number(result?.nextOffset)) state.offset = Number(result.nextOffset);
      // Открытая вкладка сама покажет уведомление; пуш нужен, когда вкладок нет.
      // Пуш не нужен, только если событие точно покажет вкладка: она с уведомлениями и
      // подключилась до записи (иначе её курсор уже за этим событием). Вкладок могло и не
      // стать за время запроса к порталу, поэтому считаем заново.
      const tabs = [...(globalThis.__sseSubscribers ?? [])].filter((raw) => {
        const tab = raw as { readyAt?: number; alerts?: boolean };
        return tab.alerts && (tab.readyAt ?? 0) < insertedAt;
      }).length;
      for (const { event } of docs)
        if (!tabs && event.kind === 'add' && event.authorId !== state.me)
          if ((!event.muted || event.mentioned) && !event.stale)
            // Сбой пуша (в том числе базы подписок) не должен ронять процесс.
            void pushEvent(memberId, event).catch((error) => console.warn('[push]', error));
      if (!result?.hasMore) break;
    }
    state.lastOkAt = Date.now();
    state.lastError = '';
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.warn('[messenger-events]', state.lastError);
  }
}

function pushEvent(memberId: string, event: MessengerEvent) {
  const { title, body } = pingText(event, { mention: 'Вас упомянули:', message: 'Сообщение' });
  return sendPush(memberId, {
    title,
    body,
    tag: `chat-${event.dialogId}`,
    url: `/messenger?dialog=${encodeURIComponent(event.dialogId)}`,
    urgent: event.mentioned,
  });
}

// Для /api/health: опрос живой, если есть открытые вкладки и последний проход был недавно.
export function getMessengerEventsHealth() {
  const { lastOkAt, startedAt, lastError, pushWanted } = getState();
  return {
    // Нужен, когда есть вкладки или пуши. Не только subscribed: если подписка падает с
    // самого начала, subscribed так и не станет true, а сбой должен быть виден.
    active: (globalThis.__sseSubscribers?.size ?? 0) > 0 || pushWanted,
    lastOkAt: Math.max(lastOkAt, startedAt),
    lastError,
  };
}

/** Звук чата переключили: список заглушённых перечитывается на следующем проходе. */
export function invalidateMuted() {
  const state = getState();
  state.mutedAt = 0;
  state.mutedGeneration += 1;
}

/** Подписку на пуш добавили или убрали: поллер узнает об этом на следующем проходе. */
export function invalidatePushWanted() {
  const state = getState();
  state.pushCheckedAt = 0;
  state.pushGeneration += 1;
}

export function startMessengerEvents() {
  // В mock-режиме портала нет, а UI-тесты событий не ждут.
  if (process.env.MOCK_B24 === '1') return;
  const state = getState();
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), POLL_MS);
}

// События мессенджера для браузеров. Обычному приложению портал шлёт их не
// push-ом, а через im.v2.Event.get: подписка пользователя, потом разбор очереди
// с подтверждением по offset. Здесь один серверный поллер на всех: он читает очередь
// и кладёт события в events_stream, откуда их уже раздаёт общий SSE /api/events.

import { bitrixPlainText } from './bitrix-markup';
import { parseMessageNodes } from './message-markdown';
import { getDb } from './mongo';
import { bx24OAuth } from './oauth-client';
import { mentionsUser, pingText } from './ping';
import { pushConfigured, pushPeople, sendPush } from './push';

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

type Person = { memberId: string; userId: string };
const personKey = (person: Person) => `${person.memberId}:${person.userId}`;

// Очередь событий у каждого человека своя: подписка, offset, свой id и заглушённые чаты.
// Читаем её его же токеном, иначе все получали бы события владельца токена портала.
type State = {
  person: Person;
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
};

type Poller = {
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  states: Map<string, State>;
  /** Люди с пуш-подписками: их очередь читаем и без открытых вкладок. */
  pushPeople: Person[];
  pushCheckedAt: number;
  pushGeneration: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __messengerPoller: Poller | undefined;
  // eslint-disable-next-line no-var
  var __sseSubscribers: Set<unknown> | undefined;
}

function poller(): Poller {
  return (globalThis.__messengerPoller ??= {
    timer: null,
    inFlight: false,
    states: new Map(),
    pushPeople: [],
    pushCheckedAt: 0,
    pushGeneration: 0,
  });
}

function stateOf(person: Person): State {
  const states = poller().states;
  let state = states.get(personKey(person));
  if (!state) {
    state = {
      person,
      subscribed: false,
      offset: 0,
      lastActive: 0,
      lastOkAt: 0,
      startedAt: 0,
      lastError: '',
      me: Number(person.userId) || 0,
      mutedChats: new Set(),
      mutedAt: 0,
      mutedGeneration: 0,
      seen: [],
    };
    states.set(personKey(person), state);
  }
  return state;
}

type Tab = { memberId?: string; userId?: string; readyAt?: number; alerts?: boolean };
const tabs = () => [...(globalThis.__sseSubscribers ?? [])] as Tab[];
const tabsOf = (person: Person) =>
  tabs().filter((tab) => tab.memberId === person.memberId && tab.userId === person.userId);

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

const as = (state: State, extra: Record<string, unknown> = {}) => ({
  ...extra,
  asUser: state.person.userId,
});

async function refreshMuted(state: State) {
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
        state.person.memberId,
        'im.recent.list',
        { SKIP_OPENLINES: 'Y', LIMIT: '200', OFFSET: String(page * 200) },
        as(state, { parallel: true }),
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

async function refreshPushPeople(all: Poller) {
  if (!pushConfigured() || Date.now() - all.pushCheckedAt < PUSH_CHECK_MS) return;
  all.pushCheckedAt = Date.now();
  // Подписку добавили, пока шла проверка: её ответ устарел, кэш сброшен и перечитается.
  const generation = all.pushGeneration;
  // Сбой базы не равен «подписок нет»: остаётся прежнее значение, повтор через 10 с.
  try {
    const people = await pushPeople();
    if (generation === all.pushGeneration) all.pushPeople = people;
  } catch (error) {
    if (generation === all.pushGeneration) all.pushCheckedAt = Date.now() - PUSH_CHECK_MS + 10_000;
    console.warn('[messenger-events] проверка пуш-подписок', error);
  }
}

// Проход занимает флаг до первого await и держит его до конца: иначе медленная проверка
// пушей пропускала второй тик, два чтения шли с одним offset, а поздняя отписка снимала
// подписку, которую следующий тик уже успел оформить заново.
async function tick() {
  const all = poller();
  if (all.inFlight) return;
  all.inFlight = true;
  try {
    await refreshPushPeople(all);
    const active = new Map<string, Person>();
    for (const tab of tabs())
      if (tab.memberId && tab.userId)
        active.set(`${tab.memberId}:${tab.userId}`, { memberId: tab.memberId, userId: tab.userId });
    for (const person of all.pushPeople) active.set(personKey(person), person);
    // Людей опрашиваем по очереди: проход короткий, а очередь каждого читает один читатель.
    for (const person of active.values()) await poll(stateOf(person));
    for (const [key, state] of all.states) if (!active.has(key)) await idle(state);
  } finally {
    all.inFlight = false;
  }
}

// Без вкладок и пушей очередь не читаем, а подписку снимаем: иначе портал копил бы
// события до суток. Вкладка могла подключиться за время прохода: проверяем заново.
async function idle(state: State) {
  if (!state.subscribed || Date.now() - state.lastActive <= IDLE_UNSUBSCRIBE_MS) return;
  if (tabsOf(state.person).length) return;
  await bx24OAuth(
    state.person.memberId,
    'im.v2.Event.unsubscribe',
    {},
    as(state, { json: true }),
  ).catch(() => {});
  state.subscribed = false;
  state.offset = 0;
}

async function poll(state: State) {
  const { memberId, userId } = state.person;
  // Простой кончился: отсчёт для health начинается заново, а не с прошлого успеха.
  if (Date.now() - state.lastActive > IDLE_UNSUBSCRIBE_MS) state.startedAt = Date.now();
  state.lastActive = Date.now();
  try {
    if (!state.subscribed) {
      await bx24OAuth(memberId, 'im.v2.Event.subscribe', {}, as(state, { json: true }));
      state.subscribed = true;
    }
    await refreshMuted(state);

    const db = await getDb();
    for (let page = 0; page < 5; page++) {
      const result = await bx24OAuth(
        memberId,
        'im.v2.Event.get',
        { limit: 100, ...(state.offset ? { offset: state.offset } : {}) },
        as(state, { json: true }),
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
        // user_id: событие видит только этот человек, а не все вкладки портала.
        docs.push({ member_id: memberId, user_id: userId, event, created_at: new Date() });
      }
      // Сначала запись, потом подтверждение: следующий запрос с offset удаляет события на
      // портале, и при сбое записи страница пропала бы. Без нового offset портал отдаст
      // её снова, а повтор отсечёт seen.
      const insertedAt = Date.now();
      if (docs.length) await db.collection('events_stream').insertMany(docs);
      remember(state, keys);
      if (Number(result?.nextOffset)) state.offset = Number(result.nextOffset);
      // Пуш не нужен, только если событие точно покажет вкладка этого человека: она с
      // уведомлениями и подключилась до записи (иначе её курсор уже за этим событием).
      const showing = tabsOf(state.person).filter(
        (tab) => tab.alerts && (tab.readyAt ?? 0) < insertedAt,
      ).length;
      for (const { event } of docs)
        if (!showing && event.kind === 'add' && event.authorId !== state.me)
          if ((!event.muted || event.mentioned) && !event.stale)
            // Сбой пуша (в том числе базы подписок) не должен ронять процесс.
            void pushEvent(state.person, event).catch((error) => console.warn('[push]', error));
      if (!result?.hasMore) break;
    }
    state.lastOkAt = Date.now();
    state.lastError = '';
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.warn('[messenger-events]', userId, state.lastError);
  }
}

function pushEvent(person: Person, event: MessengerEvent) {
  const { title, body } = pingText(event, { mention: 'Вас упомянули:', message: 'Сообщение' });
  return sendPush(person.memberId, person.userId, {
    title,
    body,
    tag: `chat-${event.dialogId}`,
    url: `/messenger?dialog=${encodeURIComponent(event.dialogId)}`,
    urgent: event.mentioned,
  });
}

// Для /api/health: опрос живой, если у каждого, кому он нужен, последний проход был недавно.
// Отдаём худшего: один сломанный токен человека тоже должен быть виден.
export function getMessengerEventsHealth() {
  const all = poller();
  const needed = new Set([
    ...tabs()
      .filter((tab) => tab.memberId && tab.userId)
      .map((tab) => `${tab.memberId}:${tab.userId}`),
    ...all.pushPeople.map(personKey),
  ]);
  let worst = { lastOkAt: Infinity, lastError: '' };
  for (const key of needed) {
    const state = all.states.get(key);
    const okAt = state ? Math.max(state.lastOkAt, state.startedAt) : 0;
    if (okAt < worst.lastOkAt) worst = { lastOkAt: okAt, lastError: state?.lastError || '' };
  }
  return {
    active: needed.size > 0,
    lastOkAt: needed.size ? worst.lastOkAt : 0,
    lastError: worst.lastError,
  };
}

/** Звук чата переключили: список заглушённых перечитывается на следующем проходе. */
export function invalidateMuted(memberId: string, userId: string) {
  const state = poller().states.get(`${memberId}:${userId}`);
  if (!state) return;
  state.mutedAt = 0;
  state.mutedGeneration += 1;
}

/** Подписку на пуш добавили или убрали: поллер узнает об этом на следующем проходе. */
export function invalidatePushWanted() {
  const all = poller();
  all.pushCheckedAt = 0;
  all.pushGeneration += 1;
}

export function startMessengerEvents() {
  // В mock-режиме портала нет, а UI-тесты событий не ждут.
  if (process.env.MOCK_B24 === '1') return;
  const all = poller();
  if (all.timer) return;
  all.timer = setInterval(() => void tick(), POLL_MS);
}

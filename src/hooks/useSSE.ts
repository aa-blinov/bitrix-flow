import { useEffect, useRef } from 'react';

// Подписка на real-time события от сервера. Соединение одно на member_id и
// общее для всех подписчиков: раньше каждый вызов хука открывал свой
// EventSource, и на странице проекта их было два, а на сводке — три.
type Listener = (event: any) => void;

const channels = new Map<string, { source: EventSource; listeners: Set<Listener> }>();

// Состояние связи держим отдельно от событий: интерфейсу нужно показать, что
// данные перестали обновляться, иначе вкладка молча живёт со старым списком.
type ConnectionState = 'connecting' | 'online' | 'offline';
const connectionListeners = new Set<(state: ConnectionState) => void>();
let connectionState: ConnectionState = 'connecting';

function setConnectionState(next: ConnectionState) {
  if (connectionState === next) return;
  connectionState = next;
  for (const listener of [...connectionListeners]) listener(next);
}

export function subscribeToConnection(listener: (state: ConnectionState) => void) {
  connectionListeners.add(listener);
  listener(connectionState);
  return () => {
    connectionListeners.delete(listener);
  };
}

/** Включены ли уведомления о чате в этом браузере (переключатель живёт в мессенджере). */
export const CHAT_NOTIFY_KEY = 'bitrix-flow-chat-notify';

function readAlertsFlag() {
  try {
    // Пушей в браузер больше нет, но флаг alerts продолжает экономить фоновым вкладкам
    // лишние события чата в SSE.
    return localStorage.getItem(CHAT_NOTIFY_KEY) === '1';
  } catch {
    return false;
  }
}

function openSource(memberId: string) {
  // alerts=1: вкладка сама покажет уведомление о чате, и пуш на другие устройства
  // сервер может не слать. Вкладка без разрешения на уведомления пуш не заменяет.
  const alerts = readAlertsFlag() ? '&alerts=1' : '';
  // Своё переоткрытие (переключили уведомления) идёт без Last-Event-ID: последний id
  // передаём сами, чтобы событие на стыке соединений не потерялось.
  const last = lastEventId.get(memberId);
  const after = last ? `&after=${encodeURIComponent(last)}` : '';
  const source = new EventSource(`/api/events?member_id=${memberId}${alerts}${after}`);
  source.onopen = () => setConnectionState('online');
  source.onerror = () => setConnectionState('offline');
  source.onmessage = (message) => {
    setConnectionState('online');
    if (message.lastEventId) lastEventId.set(memberId, message.lastEventId);
    try {
      const event = JSON.parse(message.data);
      if (event.type === 'connected') return;
      // Копия набора: слушатель может отписаться прямо в обработчике.
      for (const current of [...(channels.get(memberId)?.listeners || [])]) current(event);
    } catch {}
  };
  // EventSource сам переподключается. Не закрываем его после ошибки.
  return source;
}

const lastEventId = new Map<string, string>();

// Переключатель уведомлений общий для вкладок браузера: другие вкладки тоже
// переоткрывают соединение, иначе сервер считал бы их по старому флагу.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === CHAT_NOTIFY_KEY) reconnectSSE();
  });

/** Уведомления включили или выключили: соединение открывается заново с новым флагом. */
export function reconnectSSE() {
  for (const [memberId, channel] of channels) {
    channel.source.close();
    channel.source = openSource(memberId);
  }
}

function subscribe(memberId: string, listener: Listener) {
  let channel = channels.get(memberId);
  if (!channel) {
    channel = { source: openSource(memberId), listeners: new Set() };
    channels.set(memberId, channel);
  }
  channel.listeners.add(listener);
  return () => {
    const active = channels.get(memberId);
    if (!active) return;
    active.listeners.delete(listener);
    if (active.listeners.size === 0) {
      active.source.close();
      channels.delete(memberId);
      setConnectionState('connecting');
    }
  };
}

export function useSSE(memberId: string, onEvent: Listener) {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!memberId) return;
    return subscribe(memberId, (event) => onEventRef.current(event));
  }, [memberId]);
}

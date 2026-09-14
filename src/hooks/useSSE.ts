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

function subscribe(memberId: string, listener: Listener) {
  let channel = channels.get(memberId);
  if (!channel) {
    const source = new EventSource(`/api/events?member_id=${memberId}`);
    channel = { source, listeners: new Set() };
    channels.set(memberId, channel);
    source.onopen = () => setConnectionState('online');
    source.onerror = () => setConnectionState('offline');
    source.onmessage = (message) => {
      setConnectionState('online');
      try {
        const event = JSON.parse(message.data);
        if (event.type === 'connected') return;
        // Копия набора: слушатель может отписаться прямо в обработчике.
        for (const current of [...(channels.get(memberId)?.listeners || [])]) current(event);
      } catch {}
    };
    // EventSource сам переподключается. Не закрываем его после ошибки.
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

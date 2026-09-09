import { useEffect, useRef } from 'react';

// Подписка на real-time события от сервера. Соединение одно на member_id и
// общее для всех подписчиков: раньше каждый вызов хука открывал свой
// EventSource, и на странице проекта их было два, а на сводке — три.
type Listener = (event: any) => void;

const channels = new Map<string, { source: EventSource; listeners: Set<Listener> }>();

function subscribe(memberId: string, listener: Listener) {
  let channel = channels.get(memberId);
  if (!channel) {
    const source = new EventSource(`/api/events?member_id=${memberId}`);
    channel = { source, listeners: new Set() };
    channels.set(memberId, channel);
    source.onmessage = (message) => {
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

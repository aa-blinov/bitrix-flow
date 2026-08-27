import { useEffect, useRef } from 'react';

// Подписка на real-time события от сервера
export function useSSE(memberId: string, onEvent: (event: any) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!memberId) return;
    const url = `/api/events?member_id=${memberId}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type !== 'connected') {
          onEventRef.current(event);
        }
      } catch {}
    };

    // EventSource сам переподключается. Не закрываем его после ошибки.

    return () => {
      es.close();
    };
  }, [memberId]);
}

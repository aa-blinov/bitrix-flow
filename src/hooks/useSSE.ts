import { useEffect, useRef } from 'react';

// Подписка на real-time события от сервера
export function useSSE(memberId: string, onEvent: (event: any) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!memberId) return;
    const url = `/api/events?member_id=${memberId}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type !== 'connected') {
          onEvent(event);
        }
      } catch {}
    };

    es.onerror = () => {
      // Reconnect через 3 секунды
      setTimeout(() => {
        es.close();
        // EventSource auto-reconnect, но на всякий случай
      }, 3000);
    };

    return () => {
      es.close();
    };
  }, [memberId, onEvent]);
}

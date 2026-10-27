'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chatNotifyEnabled,
  showChatNotification,
  syncPush,
  useDebounced,
  useMessengerEvents,
} from '@/components/messenger/realtime';

const COUNTERS_POLL_MS = 60_000;

// Счётчик непрочитанных для меню и уведомления браузера о новых сообщениях.
// Живёт в боковой панели, поэтому работает на любой странице приложения.
export function useChatAlerts(pathname: string) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const me = useRef(0);

  const fetchCounters = useCallback(() => {
    void fetch('/api/messenger/counters')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        setUnread(data.unread);
        me.current = data.me;
      })
      .catch(() => {});
  }, []);
  const refresh = useDebounced(fetchCounters, 1000);

  // Подписку на пуш подтверждаем при каждой загрузке: браузер мог её сбросить, а сервер
  // удалить как мёртвую.
  useEffect(() => {
    if (chatNotifyEnabled()) void syncPush(true);
  }, []);

  useEffect(() => {
    fetchCounters();
    // Подстраховка на случай, если событие потерялось: раз в минуту, пока вкладка видна.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchCounters();
    }, COUNTERS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetchCounters]);

  useMessengerEvents((event) => {
    refresh();
    if (event.kind !== 'add' || (event.muted && !event.mentioned) || event.authorId === me.current)
      return;
    // Страница чата уже перед глазами: сообщение видно в списке и значком.
    if (document.visibilityState === 'visible' && pathname === '/messenger') return;
    showChatNotification(event, () =>
      router.push(`/messenger?dialog=${encodeURIComponent(event.dialogId)}`),
    );
  });

  return unread;
}

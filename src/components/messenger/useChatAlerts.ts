'use client';

import { useRouter } from 'next/navigation';
import { setOwnPortal } from '@/lib/portal-links';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_OPEN_EVENT,
  CHAT_READ_EVENT,
  showChatNotification,
  useDebounced,
  useMessengerEvents,
} from '@/components/messenger/realtime';

const COUNTERS_POLL_MS = 60_000;

// Счётчик непрочитанных для меню и уведомления браузера о новых сообщениях.
// Живёт в боковой панели, поэтому работает на любой странице приложения.
export function useChatAlerts() {
  const router = useRouter();
  // null — счётчик ещё не отвечал: в меню вместо него заглушка, а не «всё прочитано».
  const [unread, setUnread] = useState<number | null>(null);
  const me = useRef(0);

  // Запросы счётчика идут по одному: при медленном портале ответ «последнего
  // запущенного» не успевал бы прийти до следующего запуска, и значок не обновлялся бы.
  // Просьба во время запроса ставит ещё один проход после него.
  const inFlight = useRef(false);
  const again = useRef(false);
  const lastFetch = useRef(0);
  const repeat = useRef(() => {});
  const fetchCounters = useCallback(() => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    lastFetch.current = Date.now();
    void fetch('/api/messenger/counters')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        // Запросы идут по одному, поэтому успешный ответ всегда свежее прошлого.
        if (!data) return;
        if (data.portal) setOwnPortal(data.portal);
        setUnread(data.unread);
        me.current = data.me;
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
        if (again.current) {
          again.current = false;
          repeat.current();
        }
      });
  }, []);
  useEffect(() => {
    repeat.current = fetchCounters;
  }, [fetchCounters]);
  const refresh = useDebounced(fetchCounters, 1000);

  // Пуши убрали, а service worker остался в браузерах прежних посетителей: снимаем
  // регистрацию и подписку, чтобы значок «впилюченного SW» не копился.
  useEffect(() => {
    void navigator.serviceWorker
      ?.getRegistrations?.()
      .then((list) => Promise.all(list.map((reg) => reg.unregister())))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCounters();
    // Подстраховка на случай, если событие потерялось: раз в минуту, пока вкладка видна.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchCounters();
    }, COUNTERS_POLL_MS);
    window.addEventListener(CHAT_READ_EVENT, fetchCounters);
    // Пока вкладка была скрыта, чат могли прочитать в самом Битриксе: при возвращении
    // счётчик перечитываем сразу, а не через минуту.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchCounters();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(CHAT_READ_EVENT, fetchCounters);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchCounters]);

  useMessengerEvents((event) => {
    // При непрерывном потоке событий отложенный запрос откладывался бы бесконечно:
    // раз в пять секунд счётчик спрашиваем сразу.
    if (Date.now() - lastFetch.current > 5000) fetchCounters();
    else refresh();
    // Своё сообщение помечает сервер: он знает свой id, даже когда счётчик ещё не ответил.
    if (
      event.kind !== 'add' ||
      (event.muted && !event.mentioned) ||
      event.own ||
      event.stale ||
      event.authorId === me.current
    )
      return;
    // Этот диалог открыт перед глазами: сообщение и так видно. Сообщение в другой
    // диалог звенит и на странице чата. Видимая вкладка с этим диалогом занимает
    // уведомление молча, чтобы о нём не звенела другая, фоновая вкладка.
    const inView = () =>
      document.visibilityState === 'visible' &&
      window.location.pathname === '/messenger' &&
      new URLSearchParams(window.location.search).get('dialog') === event.dialogId;
    showChatNotification(event, inView, () => {
      window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail: event.dialogId }));
      router.push(`/messenger?dialog=${encodeURIComponent(event.dialogId)}`);
    });
  });

  return unread;
}

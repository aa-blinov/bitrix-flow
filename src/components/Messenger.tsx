'use client';

import { Bell, BellOff, BellRing, CheckCheck, Ellipsis, Pin, SquarePen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/monos/Avatar';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { IconButton } from '@/components/monos/IconButton';
import { Menu } from '@/components/monos/Menu';
import { SearchField } from '@/components/monos/SearchField';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import Conversation from '@/components/messenger/Conversation';
import { NewChatModal } from '@/components/messenger/Dialogs';
import {
  chatNotifyEnabled,
  setChatNotify,
  useDebounced,
  useMessengerEvents,
  useRealtime,
  CHAT_OPEN_EVENT,
  CHAT_READ_EVENT,
} from '@/components/messenger/realtime';
import { PresenceDot } from '@/components/messenger/Presence';
import { usePolling, when } from '@/components/messenger/util';
import {
  DIALOG_ID,
  mergeDialogs,
  portalErrorHint,
  type Dialog,
  type DialogKind,
} from '@/lib/messenger';
import { t } from '@/lib/i18n';
import { setOwnPortal } from '@/lib/portal-links';

const TABS: ReadonlyArray<{ value: 'all' | DialogKind; label: string }> = [
  {
    value: 'all',
    get label() {
      return t('Все');
    },
  },
  {
    value: 'user',
    get label() {
      return t('Личные');
    },
  },
  {
    value: 'group',
    get label() {
      return t('Группы');
    },
  },
  {
    value: 'task',
    get label() {
      return t('Задачи');
    },
  },
  {
    value: 'channel',
    get label() {
      return t('Каналы');
    },
  },
];

// Портал не присылает событий о сообщениях обычному приложению (они есть
// только у чат-ботов), поэтому список и открытый диалог обновляются опросом.
const LAST_DIALOG_KEY = 'bitrix-flow-last-dialog';
const DIALOGS_POLL_MS = 15_000;
// Пока жив SSE, список обновляют события, а опрос только подстраховывает.
const DIALOGS_POLL_REALTIME_MS = 60_000;

// Ошибка портала приходит в теле ответа: из неё берётся причина, если она понятна.
const fetchDialogs = (offset: number, me: number) =>
  fetch(`/api/messenger/dialogs?offset=${offset}&me=${me}`).then(async (response) => {
    if (response.ok) return response.json();
    const body = await response.json().catch(() => null);
    throw new Error(portalErrorHint(body?.message) || String(response.status));
  });

// Коды im.dialog.get, означающие, что диалога нет или он закрыт для этого пользователя.
const GONE_CODES = new Set([
  'ACCESS_ERROR',
  'ACCESS_DENIED',
  'DIALOG_ID_EMPTY',
  'CHAT_NOT_FOUND',
  'USER_NOT_FOUND',
  'NOT_FOUND',
]);

export default function Messenger() {
  const [dialogs, setDialogs] = useState<Dialog[] | null>(null);
  const [me, setMe] = useState(0);
  const [portal, setPortal] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'all' | DialogKind>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const lastActive = useRef('');
  const moreRef = useRef<HTMLDivElement>(null);
  const [notifyOn, setNotifyOn] = useState(false);
  // Упоминания звенят всегда отдельно: их пропустить страшнее, чем услышать лишний звон.
  const [notifyMode, setNotifyMode] = useState<'all' | 'mentions'>('all');
  // Чаты с портала по тому же запросу: список диалогов знает только последние.
  const [found, setFound] = useState<Dialog[]>([]);
  const [foundFailed, setFoundFailed] = useState(false);
  const [searching, setSearching] = useState(false);
  const realtime = useRealtime();

  useEffect(() => {
    setNotifyOn(chatNotifyEnabled());
    try {
      const mode = localStorage.getItem('bitrix-flow-chat-notify-mode');
      if (mode === 'mentions' || mode === 'all') setNotifyMode(mode);
    } catch {}
    // Адрес с номером диалога (ссылка уведомления или обновление страницы) главнее
    // последнего открытого диалога, который хранится в браузере.
    let dialog = new URLSearchParams(window.location.search).get('dialog');
    if (!dialog) {
      try {
        dialog = localStorage.getItem(LAST_DIALOG_KEY);
      } catch {}
    }
    if (dialog && DIALOG_ID.test(dialog)) setActiveId(dialog);
    // Уведомление о другом диалоге, пока страница чата открыта: адрес меняется без
    // перемонтирования, поэтому диалог переключаем по событию.
    const open = (event: Event) => {
      const id = String((event as CustomEvent<string>).detail || '');
      if (DIALOG_ID.test(id)) setActiveId(id);
    };
    window.addEventListener(CHAT_OPEN_EVENT, open);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, open);
  }, []);

  // Открытый диалог держим в адресе и в браузере: после обновления страницы человек
  // возвращается в ту же переписку.
  useEffect(() => {
    // Пока диалог не меняли, адрес и хранилище не трогаем: иначе пустой начальный
    // activeId стёр бы сохранённый диалог раньше, чем он восстановится.
    if (activeId === lastActive.current) return;
    lastActive.current = activeId;
    try {
      if (activeId) localStorage.setItem(LAST_DIALOG_KEY, activeId);
      else localStorage.removeItem(LAST_DIALOG_KEY);
    } catch {}
    window.history.replaceState(
      null,
      '',
      activeId ? `?dialog=${encodeURIComponent(activeId)}` : window.location.pathname,
    );
  }, [activeId]);

  // Курсор «Показать ещё»: опрос обновляет только первую страницу и курсор
  // не трогает, иначе подгруженные диалоги терялись бы каждые 15 секунд.
  const [paging, setPaging] = useState<{ hasMore: boolean; nextOffset: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const pagedFurther = useRef(false);

  // Ответы списка применяются по порядку запросов, а счётчик диалога, прочитанного уже
  // после начала запроса, ответ не возвращает: иначе прочитанное снова горело бы.
  const listBusy = useRef(false);
  const listAgain = useRef(false);
  const listRepeat = useRef(() => {});
  const [moreFailed, setMoreFailed] = useState(false);
  // Прочтение: когда и до какого сообщения. Сообщение новее границы ответ списка
  // показывает непрочитанным честно, его ещё не видели.
  const readAt = useRef(new Map<string, { at: number; upTo: number }>());
  const readOverride = (dialog: Dialog, startedAt: number) => {
    const read = readAt.current.get(dialog.id);
    // >=: запрос списка, начатый в ту же миллисекунду, мог не увидеть отметку.
    return read &&
      read.at >= startedAt &&
      (!read.upTo || (dialog.lastMessage?.id || 0) <= read.upTo)
      ? { ...dialog, unread: 0 }
      : dialog;
  };
  const readGen = useRef(new Map<string, number>());
  const confirmed = useRef(new Map<string, number>());
  const readsInFlight = useRef(new Map<string, number>());
  const dialogsRef = useRef<Dialog[] | null>(null);
  useEffect(() => {
    dialogsRef.current = dialogs;
  }, [dialogs]);
  // Загрузки первой страницы идут по одной: при частых событиях и медленном портале
  // каждый новый запрос отменял бы ответ прошлого, и список застывал бы. Просьба во
  // время запроса ставит ещё один проход после него.
  const loadDialogs = useCallback(() => {
    if (listBusy.current) {
      listAgain.current = true;
      return;
    }
    listBusy.current = true;
    const startedAt = Date.now();
    void fetchDialogs(0, me)
      .then((data) => {
        const fresh = data.dialogs.map((dialog: Dialog) => readOverride(dialog, startedAt));
        setDialogs((current) => mergeDialogs(current || [], fresh));
        setMe(data.me);
        if (data.portal) {
          setPortal(data.portal);
          setOwnPortal(data.portal);
        }
        // Пока дальше первой страницы не листали, курсор берём свежий: чатов могло стать
        // больше страницы, и подгрузка должна появиться.
        setPaging((current) =>
          current && pagedFurther.current
            ? current
            : { hasMore: data.hasMore, nextOffset: data.nextOffset },
        );
        setError('');
      })
      .catch((failure: Error) => {
        // Следом уже идёт новый проход: его результат важнее этой ошибки.
        if (listAgain.current) return;
        setError(
          /^\d+$/.test(failure.message)
            ? t('Не удалось загрузить диалоги. Обновите страницу.')
            : failure.message,
        );
      })
      .finally(() => {
        listBusy.current = false;
        // Подгрузка следующих страниц после сбоя снова разрешена: связь могла вернуться.
        setMoreFailed(false);
        if (listAgain.current) {
          listAgain.current = false;
          listRepeat.current();
        }
      });
  }, [me]);
  useEffect(() => {
    listRepeat.current = loadDialogs;
  }, [loadDialogs]);
  usePolling(loadDialogs, realtime ? DIALOGS_POLL_REALTIME_MS : DIALOGS_POLL_MS);

  const reload = useDebounced(loadDialogs, 700);
  // При непрерывном потоке событий отложенная загрузка откладывалась бы до конца потока:
  // раз в пять секунд список перечитываем сразу.
  const lastListLoad = useRef(0);
  useMessengerEvents(() => {
    if (Date.now() - lastListLoad.current > 5000) {
      lastListLoad.current = Date.now();
      loadDialogs();
    } else reload();
  });

  async function loadMoreDialogs() {
    if (!paging || loadingMore) return;
    setLoadingMore(true);
    try {
      const startedAt = Date.now();
      const data = await fetchDialogs(paging.nextOffset, me);
      // Страницы пересекаются: старый ответ не возвращает счётчик прочитанному диалогу.
      const fresh = data.dialogs.map((dialog: Dialog) => readOverride(dialog, startedAt));
      setDialogs((current) => mergeDialogs(current || [], fresh));
      setPaging({ hasMore: data.hasMore, nextOffset: data.nextOffset });
      pagedFurther.current = true;
    } catch {
      setError(t('Не удалось загрузить ещё диалоги.'));
      // Метка конца списка видна по-прежнему: без паузы наблюдатель повторял бы запрос
      // без остановки. Снова пробуем после ближайшего обновления списка.
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  // Подгрузка по прокрутке вместо кнопки «Показать ещё». Пока метка видна, страницы идут
  // одна за другой; с поиском и вкладками она тоже работает: отфильтрованный список мог
  // оказаться короче окна, и без этого пользователь не дотянулся бы до остального.
  useEffect(() => {
    const target = moreRef.current;
    if (
      !target ||
      !paging?.hasMore ||
      loadingMore ||
      moreFailed ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreDialogs();
    });
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paging, loadingMore, dialogs, moreFailed]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setFound([]);
      setFoundFailed(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/messenger/find?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => {
          setFoundFailed(false);
          setFound(data.dialogs);
        })
        // Сбой поиска на портале не выдаём за «Ничего не найдено».
        .catch((failure) => {
          if (failure?.name === 'AbortError') return;
          setFound([]);
          setFoundFailed(true);
        })
        .finally(() => setSearching(false));
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      setSearching(false);
    };
  }, [query]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    return (dialogs || []).filter(
      (dialog) =>
        (tab === 'all' || dialog.kind === tab) &&
        (!needle || dialog.title.toLocaleLowerCase('ru').includes(needle)),
    );
  }, [dialogs, tab, query]);
  const active = dialogs?.find((dialog) => dialog.id === activeId);

  // Диалога из адреса нет на первой странице списка: спрашиваем портал о нём отдельно.
  const portalFound = found.filter((chat) => !dialogs?.some((dialog) => dialog.id === chat.id));
  const missing = Boolean(activeId && dialogs && !dialogs.some((dialog) => dialog.id === activeId));
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void fetch(`/api/messenger/dialogs?dialogId=${encodeURIComponent(activeId)}`)
      // Портал ответил, что диалога нет или к нему нет доступа: ссылку забываем. Прочие
      // отказы (токен, лимит запросов) временные, ссылка остаётся.
      .then((response) =>
        response.ok
          ? response.json()
          : response
              .json()
              .then((body) =>
                GONE_CODES.has(String(body?.code || '')) ? { dialog: null } : Promise.reject(),
              ),
      )
      .then((data) => {
        if (cancelled) return;
        if (data?.dialog) setDialogs((current) => mergeDialogs(current || [], [data.dialog]));
        // Портал ответил, что такого диалога нет: ссылка устарела.
        else setActiveId('');
      })
      // Сбой сети или портала не значит, что диалога нет: ссылку не теряем.
      .catch(() => {
        if (!cancelled) setError(t('Не удалось открыть диалог. Обновите страницу.'));
      });
    return () => {
      cancelled = true;
    };
  }, [missing, activeId]);

  // Ноль в списке сразу, а портал догоняет. Отказ портала возвращает настоящий счётчик
  // диалога, иначе список показывал бы прочитанным то, что в Битриксе не прочитано.
  const markRead = useCallback((id: string, messageId = 0): Promise<boolean> => {
    // Отметки одного диалога могут идти одновременно: откатывать счётчик и границу
    // вправе только последняя, иначе поздний сбой старой затёр бы успешную новую.
    const mine = (readGen.current.get(id) || 0) + 1;
    readGen.current.set(id, mine);
    readsInFlight.current.set(id, (readsInFlight.current.get(id) || 0) + 1);
    // Цепочка параллельных отметок кончилась: подтверждённый счётчик больше не нужен,
    // иначе его старый ноль достался бы следующей, уже не связанной отметке.
    const settle = () => {
      const left = (readsInFlight.current.get(id) || 1) - 1;
      if (left) readsInFlight.current.set(id, left);
      else {
        readsInFlight.current.delete(id);
        confirmed.current.delete(id);
      }
    };
    const latest = () => readGen.current.get(id) === mine;
    readAt.current.set(id, { at: Date.now(), upTo: messageId });
    // Прежний счётчик нужен, если ни отметка, ни перечитывание не удались: ноль из
    // пустого ответа выводить нельзя.
    // Пока идут отметки, подтверждённым остаётся счётчик до первой из них: вторая
    // увидела бы уже оптимистичный ноль.
    const before = confirmed.current.has(id)
      ? (confirmed.current.get(id) as number)
      : (dialogsRef.current?.find((d) => d.id === id)?.unread ?? 0);
    confirmed.current.set(id, before);
    const restore = (unread: number) => {
      if (latest()) confirmed.current.delete(id);
      if (latest())
        setDialogs(
          (current) => current && current.map((d) => (d.id === id ? { ...d, unread } : d)),
        );
    };
    // Ноль сразу, только если в списке нет сообщения новее границы: его ещё не видели.
    setDialogs(
      (current) =>
        current &&
        current.map((d) =>
          d.id === id && (!messageId || (d.lastMessage?.id || 0) <= messageId)
            ? { ...d, unread: 0 }
            : d,
        ),
    );
    return fetch('/api/messenger/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialogId: id, messageId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        // Прочтение подтверждено: откат параллельной отметки не вернёт этот счётчик.
        // Значение живёт до конца цепочки, его убирает settle.
        confirmed.current.set(id, 0);
        window.dispatchEvent(new Event(CHAT_READ_EVENT));
        return true;
      })
      .catch(() => {
        if (latest()) readAt.current.delete(id);
        return (
          fetch(`/api/messenger/dialogs?dialogId=${encodeURIComponent(id)}`)
            .then((response) => (response.ok ? response.json() : null))
            // Счётчик берём из ответа напрямую: дата у этой записи от создания чата, и
            // mergeDialogs отверг бы её как более старую.
            // Без ответа портала откатываемся к подтверждённому: если за это время другая
            // отметка прошла успешно, это уже ноль, а не счётчик до первой.
            .then((data) =>
              restore(
                data?.dialog
                  ? Number(data.dialog.unread) || 0
                  : (confirmed.current.get(id) ?? before),
              ),
            )
            .catch(() => restore(confirmed.current.get(id) ?? before))
            .then(() => false)
        );
      })
      .finally(settle);
  }, []);

  // Все диалоги прочитаны одним вызовом портала: счётчики гасим сразу, при отказе перечитываем.
  async function readAll() {
    setDialogs((current) => current && current.map((item) => ({ ...item, unread: 0 })));
    const response = await fetch('/api/messenger/dialog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'readAll' }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(t('Не удалось отметить все диалоги прочитанными.'));
      loadDialogs();
      return;
    }
    window.dispatchEvent(new Event(CHAT_READ_EVENT));
  }

  // Настройки диалога меняются сразу, а портал догоняет: при отказе список перечитывается.
  async function dialogAction(
    dialog: Dialog,
    action: 'pin' | 'unpin' | 'unread' | 'mute' | 'unmute',
  ) {
    setDialogs(
      (current) =>
        current &&
        mergeDialogs(
          current.filter((item) => item.id !== dialog.id),
          [
            {
              ...dialog,
              pinned: action === 'pin' ? true : action === 'unpin' ? false : dialog.pinned,
              muted: action === 'mute' ? true : action === 'unmute' ? false : dialog.muted,
              unread: action === 'unread' ? Math.max(1, dialog.unread) : dialog.unread,
            },
          ],
        ),
    );
    const response = await fetch('/api/messenger/dialog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialogId: dialog.id, action }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(t('Не удалось изменить настройки диалога.'));
      loadDialogs();
      return;
    }
    // Ручная отметка «непрочитанным» меняет и значок в меню.
    if (action === 'unread') window.dispatchEvent(new Event(CHAT_READ_EVENT));
  }

  async function toggleNotify() {
    const next = await setChatNotify(!notifyOn);
    setNotifyOn(next);
  }

  function setNotifySoundMode(mode: 'all' | 'mentions') {
    try {
      localStorage.setItem('bitrix-flow-chat-notify-mode', mode);
    } catch {}
    setNotifyMode(mode);
  }

  // Новый диалог с человеком или созданная группа появятся в списке портала
  // только после первого сообщения, поэтому до тех пор держим их заготовкой.
  const openDialog = useCallback(
    (dialog: Pick<Dialog, 'id' | 'kind' | 'title' | 'avatar' | 'presence'>) => {
      setDialogs((current) =>
        current?.some((item) => item.id === dialog.id)
          ? current
          : mergeDialogs(current || [], [
              { ...dialog, unread: 0, date: new Date().toISOString(), local: true },
            ]),
      );
      setActiveId(dialog.id);
      setNewChatOpen(false);
    },
    [],
  );

  return (
    // На телефоне внизу страницы 5rem под плавающую кнопку меню (pb-20 у main): отнимаем их,
    // чтобы страница не прокручивалась и кнопка не лежала на поле ввода.
    <div className="flex h-[calc(100dvh-5rem)] flex-col bg-canvas lg:h-dvh">
      <PageHeader
        title={t('Сообщения')}
        description={t('Личные чаты, группы и обсуждения задач из Битрикс24')}
      />
      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger-text lg:px-6">
          {error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[22rem_1fr]">
        <section
          aria-label={t('Диалоги')}
          className={`${activeId ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-line`}
        >
          <div className="space-y-2 border-b border-line p-3">
            <div className="flex items-center gap-2">
              <SearchField
                label={t('Поиск по диалогам')}
                placeholder={t('Поиск по диалогам')}
                size="sm"
                value={query}
                onChange={setQuery}
                className="min-w-0 flex-1"
              />
              <Menu
                portal
                align="end"
                width="auto"
                label={t('Режим уведомлений')}
                trigger={
                  <IconButton
                    label={notifyOn ? t('Режим уведомлений') : t('Включить уведомления')}
                    variant="outline"
                    size="md"
                    pressed={notifyOn}
                    onClick={() => void toggleNotify()}
                  >
                    {notifyOn ? (
                      notifyMode === 'mentions' ? (
                        <BellRing className="size-4" strokeWidth={1.7} />
                      ) : (
                        <Bell className="size-4" strokeWidth={1.7} />
                      )
                    ) : (
                      <BellOff className="size-4" strokeWidth={1.7} />
                    )}
                  </IconButton>
                }
                items={[
                  ...(notifyOn
                    ? [
                        {
                          value: 'all',
                          label: t('Звенеть на все сообщения'),
                          disabled: notifyMode === 'all',
                          onSelect: () => setNotifySoundMode('all'),
                        },
                        {
                          value: 'mentions',
                          label: t('Звенеть только на упоминания'),
                          disabled: notifyMode === 'mentions',
                          onSelect: () => setNotifySoundMode('mentions'),
                        },
                        {
                          value: 'off',
                          label: t('Выключить уведомления'),
                          onSelect: () => void toggleNotify(),
                        },
                      ]
                    : [
                        {
                          value: 'on',
                          label: t('Включить уведомления'),
                          onSelect: () => void toggleNotify(),
                        },
                      ]),
                ]}
              />
              <IconButton
                label={t('Прочитать все')}
                variant="outline"
                size="md"
                disabled={!dialogs?.some((item) => item.unread > 0)}
                onClick={() => void readAll()}
              >
                <CheckCheck className="size-4" strokeWidth={1.7} />
              </IconButton>
              <IconButton
                label={t('Новый чат')}
                variant="outline"
                size="md"
                onClick={() => setNewChatOpen(true)}
              >
                <SquarePen className="size-4" strokeWidth={1.7} />
              </IconButton>
            </div>
            <SegmentedControl
              label={t('Тип диалога')}
              size="sm"
              // Пять вкладок в узкой колонке: сжимаем поля и разрядку, иначе последняя уходит под переписку.
              className="w-full [&_button]:flex-1 [&_button]:px-1.5 [&_button]:tracking-wide"
              options={[...TABS]}
              value={tab}
              onChange={(value) => setTab(value as typeof tab)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {searching && (
              <p className="px-3 py-2 text-xs text-ink-faint" role="status" aria-live="polite">
                {t('Поиск…')}
              </p>
            )}
            {portalFound.length > 0 && (
              <div className="border-b border-line">
                <p className="px-3 pt-3 pb-1 text-xs uppercase tracking-widest text-ink-soft">
                  {t('Найдено на портале')}
                </p>
                <ul aria-label={t('Найдено на портале')}>
                  {portalFound.map((chat) => (
                    <li key={chat.id}>
                      <button
                        type="button"
                        onClick={() => openDialog(chat)}
                        className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
                      >
                        <Avatar name={chat.title} src={chat.avatar} size="md" />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          {chat.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dialogs === null ? (
              error ? null : (
                <LoadingState className="min-h-40 bg-transparent" />
              )
            ) : visible.length === 0 ? (
              <p className="p-4 text-sm text-ink-soft">
                {foundFailed
                  ? t(
                      'Поиск чатов на портале не выполнился. Измените запрос, чтобы попробовать ещё раз.',
                    )
                  : t('Ничего не найдено')}
              </p>
            ) : (
              <ul>
                {visible.map((dialog) => (
                  <li key={dialog.id} className="group relative">
                    <button
                      type="button"
                      aria-current={dialog.id === activeId ? 'true' : undefined}
                      // Прочитанным диалог отметит сама переписка, когда последние сообщения
                      // загрузятся и будут видны.
                      onClick={() => setActiveId(dialog.id)}
                      // На телефоне меню «…» видно всегда: строка оставляет ему место справа,
                      // иначе кнопка ложилась поверх даты последнего сообщения.
                      className={`flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-2 max-sm:pr-12 ${
                        dialog.id === activeId ? 'bg-surface-2' : ''
                      }`}
                    >
                      <span className="relative shrink-0">
                        <Avatar name={dialog.title} src={dialog.avatar} size="md" />
                        <PresenceDot
                          presence={dialog.presence}
                          className="absolute -right-0.5 -bottom-0.5 border-2 border-canvas"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1">
                            {dialog.pinned && (
                              <Pin
                                className="size-3 shrink-0 text-ink-soft"
                                strokeWidth={1.7}
                                aria-label={t('Закреплён')}
                              />
                            )}
                            <span className="truncate text-sm font-medium text-ink">
                              {dialog.title}
                            </span>
                          </span>
                          <time className="shrink-0 text-xs text-ink-soft" dateTime={dialog.date}>
                            {when(dialog.date)}
                          </time>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-ink-soft">
                            {dialog.lastMessage?.text}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {dialog.muted && (
                              <BellOff
                                className="size-3 text-ink-soft"
                                strokeWidth={1.7}
                                aria-label={t('Звук отключён')}
                              />
                            )}
                            {dialog.unread > 0 && (
                              <Badge
                                tone={dialog.muted ? 'neutral' : 'accent'}
                                dot
                                aria-label={t('Непрочитанных: {0}', dialog.unread)}
                              >
                                {dialog.unread}
                              </Badge>
                            )}
                          </span>
                        </span>
                      </span>
                    </button>
                    {/* На десктопе меню появляется по наведению поверх даты: подложка цвета
                        строки прячет дату под ним, а не смешивает два слоя. По центру через
                        my-auto, не transform: transform создаёт свой слой наложения, и открытое
                        меню уходило под следующую строку списка. */}
                    <div className="absolute top-0 right-1 bottom-0 my-auto hidden h-fit rounded-ui bg-surface-2 group-focus-within:block group-hover:block max-sm:block max-sm:bg-transparent">
                      <Menu
                        label={t('Действия с диалогом')}
                        align="end"
                        width="auto"
                        trigger={
                          <IconButton
                            label={t('Действия с диалогом')}
                            variant="ghost"
                            size="sm"
                            tooltipText=""
                          >
                            <Ellipsis className="size-4" strokeWidth={1.7} />
                          </IconButton>
                        }
                        items={[
                          {
                            label: dialog.pinned ? t('Открепить') : t('Закрепить'),
                            onSelect: () =>
                              void dialogAction(dialog, dialog.pinned ? 'unpin' : 'pin'),
                          },
                          {
                            label: t('Пометить непрочитанным'),
                            onSelect: () => void dialogAction(dialog, 'unread'),
                          },
                          {
                            label: dialog.muted ? t('Включить звук') : t('Отключить звук'),
                            onSelect: () =>
                              void dialogAction(dialog, dialog.muted ? 'unmute' : 'mute'),
                          },
                        ]}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* Сбой поиска на портале виден и тогда, когда что-то нашлось в загруженном списке. */}
            {foundFailed && visible.length > 0 && (
              <p className="px-3 py-2 text-xs text-ink-soft">
                {t(
                  'Поиск чатов на портале не выполнился. Измените запрос, чтобы попробовать ещё раз.',
                )}
              </p>
            )}
            {paging?.hasMore && (
              // Метка конца списка: когда она попадает в окно, подгружается следующая страница.
              <div ref={moreRef} className="p-3 text-center text-xs text-ink-soft" role="status">
                {loadingMore ? t('Загрузка') : ''}
              </div>
            )}
          </div>
        </section>
        <section
          aria-label={t('Переписка')}
          className={`${activeId ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}
        >
          {active ? (
            <Conversation
              key={active.id}
              dialog={active}
              dialogs={dialogs || []}
              me={me}
              portal={portal}
              onBack={() => setActiveId('')}
              onRead={markRead}
              onSent={loadDialogs}
              onPin={() => void dialogAction(active, active.pinned ? 'unpin' : 'pin')}
              onRenamed={(title) =>
                setDialogs((current) =>
                  current
                    ? current.map((d) => (d.id === active.id ? { ...d, title } : d))
                    : current,
                )
              }
              onLeft={() => {
                const left = active.id;
                setDialogs((current) => (current ? current.filter((d) => d.id !== left) : current));
                // Пока портал отвечал, могли открыть другой диалог: его не закрываем.
                setActiveId((current) => (current === left ? '' : current));
              }}
            />
          ) : (
            <p className="m-auto p-6 text-sm text-ink-soft">{t('Выберите диалог слева')}</p>
          )}
        </section>
      </div>
      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} onOpen={openDialog} />
    </div>
  );
}

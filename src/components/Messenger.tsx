'use client';

import { Bell, BellOff, Ellipsis, Pin, SquarePen } from 'lucide-react';
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
} from '@/components/messenger/realtime';
import { PresenceDot } from '@/components/messenger/Presence';
import { usePolling, when } from '@/components/messenger/util';
import { DIALOG_ID, mergeDialogs, type Dialog, type DialogKind } from '@/lib/messenger';

const TABS: ReadonlyArray<{ value: 'all' | DialogKind; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'user', label: 'Личные' },
  { value: 'group', label: 'Группы' },
  { value: 'task', label: 'Задачи' },
  { value: 'channel', label: 'Каналы' },
];

// Портал не присылает событий о сообщениях обычному приложению (они есть
// только у чат-ботов), поэтому список и открытый диалог обновляются опросом.
const LAST_DIALOG_KEY = 'bitrix-flow-last-dialog';
const DIALOGS_POLL_MS = 15_000;
// Пока жив SSE, список обновляют события, а опрос только подстраховывает.
const DIALOGS_POLL_REALTIME_MS = 60_000;

const fetchDialogs = (offset: number, me: number) =>
  fetch(`/api/messenger/dialogs?offset=${offset}&me=${me}`).then((response) =>
    response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
  );

export default function Messenger() {
  const [dialogs, setDialogs] = useState<Dialog[] | null>(null);
  const [me, setMe] = useState(0);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'all' | DialogKind>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const lastActive = useRef('');
  const [notifyOn, setNotifyOn] = useState(false);
  const realtime = useRealtime();

  useEffect(() => {
    setNotifyOn(chatNotifyEnabled());
    // Адрес с номером диалога (ссылка уведомления или обновление страницы) главнее
    // последнего открытого диалога, который хранится в браузере.
    let dialog = new URLSearchParams(window.location.search).get('dialog');
    if (!dialog) {
      try {
        dialog = localStorage.getItem(LAST_DIALOG_KEY);
      } catch {}
    }
    if (dialog && DIALOG_ID.test(dialog)) setActiveId(dialog);
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

  const loadDialogs = useCallback(() => {
    void fetchDialogs(0, me)
      .then((data) => {
        setDialogs((current) => mergeDialogs(current || [], data.dialogs));
        setMe(data.me);
        setPaging((current) => current || { hasMore: data.hasMore, nextOffset: data.nextOffset });
        setError('');
      })
      .catch(() => setError('Не удалось загрузить диалоги. Обновите страницу.'));
  }, [me]);
  usePolling(loadDialogs, realtime ? DIALOGS_POLL_REALTIME_MS : DIALOGS_POLL_MS);

  const reload = useDebounced(loadDialogs, 700);
  useMessengerEvents(reload);

  async function loadMoreDialogs() {
    if (!paging || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchDialogs(paging.nextOffset, me);
      setDialogs((current) => mergeDialogs(current || [], data.dialogs));
      setPaging({ hasMore: data.hasMore, nextOffset: data.nextOffset });
    } catch {
      setError('Не удалось загрузить ещё диалоги.');
    } finally {
      setLoadingMore(false);
    }
  }

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
  const missing = Boolean(activeId && dialogs && !dialogs.some((dialog) => dialog.id === activeId));
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void fetch(`/api/messenger/dialogs?dialogId=${encodeURIComponent(activeId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.dialog) setDialogs((current) => mergeDialogs(current || [], [data.dialog]));
        else setActiveId('');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missing, activeId]);

  const markRead = useCallback((id: string) => {
    setDialogs((current) => current && current.map((d) => (d.id === id ? { ...d, unread: 0 } : d)));
    void fetch('/api/messenger/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialogId: id }),
    });
  }, []);

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
      setError('Не удалось изменить настройки диалога.');
      loadDialogs();
    }
  }

  async function toggleNotify() {
    const next = await setChatNotify(!notifyOn);
    setNotifyOn(next);
    if (!next && !notifyOn)
      setError('Браузер не разрешил уведомления: включите их в настройках сайта.');
  }

  // Новый диалог с человеком или созданная группа появятся в списке портала
  // только после первого сообщения, поэтому до тех пор держим их заготовкой.
  const openDialog = useCallback(
    (dialog: Pick<Dialog, 'id' | 'kind' | 'title' | 'avatar' | 'presence'>) => {
      setDialogs((current) =>
        current?.some((item) => item.id === dialog.id)
          ? current
          : mergeDialogs(current || [], [{ ...dialog, unread: 0, date: new Date().toISOString() }]),
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
        title="Сообщения"
        description="Личные чаты, группы и обсуждения задач из Битрикс24"
      />
      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger-text lg:px-6">
          {error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[22rem_1fr]">
        <section
          aria-label="Диалоги"
          className={`${activeId ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-line`}
        >
          <div className="space-y-2 border-b border-line p-3">
            <div className="flex items-center gap-2">
              <SearchField
                label="Поиск по диалогам"
                placeholder="Поиск по диалогам"
                size="sm"
                value={query}
                onChange={setQuery}
                className="min-w-0 flex-1"
              />
              <IconButton
                label={notifyOn ? 'Отключить уведомления' : 'Включить уведомления'}
                variant="outline"
                size="md"
                pressed={notifyOn}
                onClick={() => void toggleNotify()}
              >
                {notifyOn ? (
                  <Bell className="size-4" strokeWidth={1.7} />
                ) : (
                  <BellOff className="size-4" strokeWidth={1.7} />
                )}
              </IconButton>
              <IconButton
                label="Новый чат"
                variant="outline"
                size="md"
                onClick={() => setNewChatOpen(true)}
              >
                <SquarePen className="size-4" strokeWidth={1.7} />
              </IconButton>
            </div>
            <SegmentedControl
              label="Тип диалога"
              size="sm"
              // Пять вкладок в узкой колонке: сжимаем поля и разрядку, иначе последняя уходит под переписку.
              className="w-full [&_button]:flex-1 [&_button]:px-1.5 [&_button]:tracking-wide"
              options={[...TABS]}
              value={tab}
              onChange={(value) => setTab(value as typeof tab)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {dialogs === null ? (
              error ? null : (
                <LoadingState className="min-h-40 bg-transparent" />
              )
            ) : visible.length === 0 ? (
              <p className="p-4 text-sm text-ink-soft">Ничего не найдено</p>
            ) : (
              <ul>
                {visible.map((dialog) => (
                  <li key={dialog.id} className="group relative">
                    <button
                      type="button"
                      aria-current={dialog.id === activeId ? 'true' : undefined}
                      onClick={() => {
                        setActiveId(dialog.id);
                        if (dialog.unread) markRead(dialog.id);
                      }}
                      className={`flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-2 ${
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
                                aria-label="Закреплён"
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
                                aria-label="Звук отключён"
                              />
                            )}
                            {dialog.unread > 0 && (
                              <Badge
                                tone={dialog.muted ? 'neutral' : 'accent'}
                                dot
                                aria-label={`Непрочитанных: ${dialog.unread}`}
                              >
                                {dialog.unread}
                              </Badge>
                            )}
                          </span>
                        </span>
                      </span>
                    </button>
                    <div className="absolute top-1 right-1 hidden group-focus-within:block group-hover:block max-sm:block">
                      <Menu
                        label="Действия с диалогом"
                        align="end"
                        width="auto"
                        trigger={
                          <IconButton
                            label="Действия с диалогом"
                            variant="ghost"
                            size="sm"
                            tooltipText=""
                          >
                            <Ellipsis className="size-4" strokeWidth={1.7} />
                          </IconButton>
                        }
                        items={[
                          {
                            label: dialog.pinned ? 'Открепить' : 'Закрепить',
                            onSelect: () =>
                              void dialogAction(dialog, dialog.pinned ? 'unpin' : 'pin'),
                          },
                          {
                            label: 'Пометить непрочитанным',
                            onSelect: () => void dialogAction(dialog, 'unread'),
                          },
                          {
                            label: dialog.muted ? 'Включить звук' : 'Отключить звук',
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
            {paging?.hasMore && (
              <div className="p-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => void loadMoreDialogs()}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Загрузка' : 'Показать ещё'}
                </Button>
              </div>
            )}
          </div>
        </section>
        <section
          aria-label="Переписка"
          className={`${activeId ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}
        >
          {active ? (
            <Conversation
              key={active.id}
              dialog={active}
              dialogs={dialogs || []}
              me={me}
              onBack={() => setActiveId('')}
              onRead={markRead}
              onSent={loadDialogs}
              onPin={() => void dialogAction(active, active.pinned ? 'unpin' : 'pin')}
            />
          ) : (
            <p className="m-auto p-6 text-sm text-ink-soft">Выберите диалог слева</p>
          )}
        </section>
      </div>
      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} onOpen={openDialog} />
    </div>
  );
}

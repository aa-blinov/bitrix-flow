'use client';

import { SquarePen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Avatar } from '@/components/monos/Avatar';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { IconButton } from '@/components/monos/IconButton';
import { SearchField } from '@/components/monos/SearchField';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import Conversation from '@/components/messenger/Conversation';
import { NewChatModal } from '@/components/messenger/Dialogs';
import { usePolling, when } from '@/components/messenger/util';
import { mergeDialogs, type Dialog, type DialogKind } from '@/lib/messenger';

const TABS: ReadonlyArray<{ value: 'all' | DialogKind; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'user', label: 'Личные' },
  { value: 'group', label: 'Группы' },
  { value: 'task', label: 'Задачи' },
  { value: 'channel', label: 'Каналы' },
];

// Портал не присылает событий о сообщениях обычному приложению (они есть
// только у чат-ботов), поэтому список и открытый диалог обновляются опросом.
const DIALOGS_POLL_MS = 15_000;

const fetchDialogs = (offset: number) =>
  fetch(`/api/messenger/dialogs?offset=${offset}`).then((response) =>
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

  // Курсор «Показать ещё»: опрос обновляет только первую страницу и курсор
  // не трогает, иначе подгруженные диалоги терялись бы каждые 15 секунд.
  const [paging, setPaging] = useState<{ hasMore: boolean; nextOffset: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadDialogs = useCallback(() => {
    void fetchDialogs(0)
      .then((data) => {
        setDialogs((current) => mergeDialogs(current || [], data.dialogs));
        setMe(data.me);
        setPaging((current) => current || { hasMore: data.hasMore, nextOffset: data.nextOffset });
        setError('');
      })
      .catch(() => setError('Не удалось загрузить диалоги. Обновите страницу.'));
  }, []);
  usePolling(loadDialogs, DIALOGS_POLL_MS);

  async function loadMoreDialogs() {
    if (!paging || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchDialogs(paging.nextOffset);
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

  const markRead = useCallback((id: string) => {
    setDialogs((current) => current && current.map((d) => (d.id === id ? { ...d, unread: 0 } : d)));
    void fetch('/api/messenger/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dialogId: id }),
    });
  }, []);

  // Новый диалог с человеком или созданная группа появятся в списке портала
  // только после первого сообщения, поэтому до тех пор держим их заготовкой.
  const openDialog = useCallback((dialog: Pick<Dialog, 'id' | 'kind' | 'title' | 'avatar'>) => {
    setDialogs((current) =>
      current?.some((item) => item.id === dialog.id)
        ? current
        : mergeDialogs(current || [], [{ ...dialog, unread: 0, date: new Date().toISOString() }]),
    );
    setActiveId(dialog.id);
    setNewChatOpen(false);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-canvas">
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
                  <li key={dialog.id}>
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
                      <Avatar name={dialog.title} src={dialog.avatar} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-ink">
                            {dialog.title}
                          </span>
                          <time className="shrink-0 text-xs text-ink-soft" dateTime={dialog.date}>
                            {when(dialog.date)}
                          </time>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-ink-soft">
                            {dialog.lastMessage?.text}
                          </span>
                          {dialog.unread > 0 && (
                            <Badge tone="accent" dot aria-label={`Непрочитанных: ${dialog.unread}`}>
                              {dialog.unread}
                            </Badge>
                          )}
                        </span>
                      </span>
                    </button>
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

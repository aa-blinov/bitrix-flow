'use client';

import Link from 'next/link';
import { ArrowLeft, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/monos/Avatar';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { SearchField } from '@/components/monos/SearchField';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { TextArea } from '@/components/monos/TextArea';
import BitrixText from '@/components/BitrixText';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import type { Dialog, DialogKind, Message, Person } from '@/lib/messenger';

const TABS: ReadonlyArray<{ value: 'all' | DialogKind; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'user', label: 'Личные' },
  { value: 'group', label: 'Группы' },
  { value: 'task', label: 'Задачи' },
];

// Портал не присылает событий о сообщениях обычному приложению (они есть
// только у чат-ботов), поэтому список и открытый диалог обновляются опросом.
const DIALOGS_POLL_MS = 15_000;
const MESSAGES_POLL_MS = 5_000;

const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

function when(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toDateString() === new Date().toDateString()
    ? TIME.format(parsed)
    : DAY.format(parsed);
}

// Опрос стоит только пока вкладка видна: фоновая вкладка иначе читала бы
// портал круглосуточно.
function usePolling(run: () => void, delay: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, delay);
    return () => window.clearInterval(timer);
  }, [run, delay, enabled]);
}

export default function Messenger() {
  const [dialogs, setDialogs] = useState<Dialog[] | null>(null);
  const [me, setMe] = useState(0);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'all' | DialogKind>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('');

  const loadDialogs = useCallback(() => {
    void fetch('/api/messenger/dialogs')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((data) => {
        setDialogs(data.dialogs);
        setMe(data.me);
        setError('');
      })
      .catch(() => setError('Не удалось загрузить диалоги. Обновите страницу.'));
  }, []);
  usePolling(loadDialogs, DIALOGS_POLL_MS);

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
            <SearchField
              label="Поиск по диалогам"
              placeholder="Поиск по диалогам"
              size="sm"
              value={query}
              onChange={setQuery}
            />
            <SegmentedControl
              label="Тип диалога"
              size="sm"
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
    </div>
  );
}

function Conversation({
  dialog,
  me,
  onBack,
  onRead,
  onSent,
}: {
  dialog: Dialog;
  me: number;
  onBack: () => void;
  onRead: (id: string) => void;
  onSent: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const lastSeen = useRef(0);

  const load = useCallback(() => {
    void fetch(`/api/messenger/messages?dialogId=${encodeURIComponent(dialog.id)}`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((data: { messages: Message[]; people: Record<string, Person> }) => {
        setMessages(data.messages);
        setPeople((known) => ({ ...known, ...data.people }));
        const newest = data.messages.at(-1)?.id || 0;
        // Пришло чужое сообщение в открытом диалоге: сразу прочитано.
        if (newest > lastSeen.current && lastSeen.current && data.messages.at(-1)?.authorId !== me)
          onRead(dialog.id);
        lastSeen.current = newest;
      })
      .catch(() => setError('Не удалось загрузить сообщения.'));
  }, [dialog.id, me, onRead]);
  usePolling(load, MESSAGES_POLL_MS);

  const newestId = messages?.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [newestId]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/messenger/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dialogId: dialog.id, text }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setDraft('');
      load();
      onSent();
    } catch {
      // Черновик остаётся в поле: текст не теряется, можно отправить ещё раз.
      setError('Сообщение не отправилось. Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  const link =
    dialog.kind === 'task' && dialog.entityId
      ? `/all-tasks?task=${encodeURIComponent(dialog.entityId)}`
      : dialog.kind === 'group' && dialog.entityId
        ? `/projects/${encodeURIComponent(dialog.entityId)}`
        : null;

  return (
    <>
      <div className="flex min-h-14 items-center gap-3 border-b border-line px-3">
        <Button
          variant="quiet"
          size="sm"
          className="md:hidden"
          onClick={onBack}
          aria-label="К списку диалогов"
        >
          <ArrowLeft className="size-4" strokeWidth={1.7} />
        </Button>
        <Avatar name={dialog.title} src={dialog.avatar} size="sm" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{dialog.title}</h2>
        {link && (
          <Link href={link} className="shrink-0 text-xs text-accent-text hover:underline">
            {dialog.kind === 'task' ? 'Открыть задачу' : 'Открыть проект'}
          </Link>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
        {messages === null ? (
          error ? null : (
            <LoadingState className="min-h-40 bg-transparent" />
          )
        ) : (
          messages.map((message) => {
            const mine = message.authorId === me;
            // Служебные записи чата (автор 0) показываем тихой строкой по центру.
            if (message.authorId === 0)
              return (
                <p key={message.id} className="text-center text-xs text-ink-soft">
                  <BitrixText text={message.text} />
                </p>
              );
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-ui border border-line px-3 py-2 ${mine ? 'bg-surface-2' : 'bg-surface'}`}
                >
                  {!mine && dialog.kind !== 'user' && (
                    <p className="text-xs font-medium text-accent-text">
                      {people[String(message.authorId)]?.name || `Пользователь ${message.authorId}`}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm text-ink">
                    <BitrixText text={message.text || '[Вложение]'} />
                  </p>
                  <time
                    className="mt-1 block text-right text-xs text-ink-soft"
                    dateTime={message.date}
                  >
                    {when(message.date)}
                  </time>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <p role="alert" className="px-4 pb-1 text-sm text-danger-text">
          {error}
        </p>
      )}
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <TextArea
          aria-label="Сообщение"
          placeholder="Сообщение"
          variant="boxed"
          rows={1}
          className="flex-1"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter отправляет, Shift+Enter переносит строку, как в самом Битриксе.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button type="submit" disabled={!draft.trim() || sending} aria-label="Отправить">
          <Send className="size-4" strokeWidth={1.7} />
        </Button>
      </form>
    </>
  );
}

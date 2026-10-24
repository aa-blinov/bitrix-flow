'use client';

import Link from 'next/link';
import { ArrowLeft, Check, CheckCheck, FileText, Mic, Paperclip, Send, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/monos/Avatar';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { SearchField } from '@/components/monos/SearchField';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { TextArea } from '@/components/monos/TextArea';
import BitrixText from '@/components/BitrixText';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import {
  MAX_FILE_SIZE,
  MESSAGES_PAGE,
  VOICE_NAME,
  formatBytes,
  mergeDialogs,
  mergeMessages,
  readersOf,
  type Attach,
  type Dialog,
  type DialogKind,
  type Message,
  type MessageFile,
  type Person,
  type Reader,
} from '@/lib/messenger';
import { safeHref } from '@/lib/safe-url';

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
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // null пока портал не ответил: галочки без данных не рисуем.
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [canRecord, setCanRecord] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const newestRef = useRef(0);
  // Читатель отлистал вверх: новое сообщение не должно утаскивать его вниз.
  const stickToBottom = useRef(true);
  const heightBeforePrepend = useRef(0);

  const dialogId = dialog.id;
  const request = useCallback(
    (cursor: string) =>
      fetch(
        `/api/messenger/messages?dialogId=${encodeURIComponent(dialogId)}&me=${me}${cursor}`,
      ).then((response) =>
        response.ok
          ? (response.json() as Promise<{
              messages: Message[];
              people: Record<string, Person>;
              readers?: Reader[];
            }>)
          : Promise.reject(new Error(String(response.status))),
      ),
    [dialogId, me],
  );

  // Первый запрос берёт последние сообщения, дальше опрос идёт курсором
  // afterId (FIRST_ID портала) и тянет только новое, не затирая подгруженную историю.
  const load = useCallback(() => {
    const after = newestRef.current;
    void request(after ? `&afterId=${after}` : '')
      .then((data) => {
        setMessages((current) => mergeMessages(current || [], data.messages));
        setPeople((known) => ({ ...known, ...data.people }));
        if (data.readers) setReaders(data.readers);
        if (!after) setHasOlder(data.messages.length >= MESSAGES_PAGE);
        // Пришло чужое сообщение в открытом диалоге: сразу прочитано.
        if (after && data.messages.some((m) => m.id > after && m.authorId !== me)) onRead(dialogId);
        newestRef.current = Math.max(after, ...data.messages.map((m) => m.id));
      })
      .catch(() => setError('Не удалось загрузить сообщения.'));
  }, [request, dialogId, me, onRead]);
  usePolling(load, MESSAGES_POLL_MS);

  const oldestId = messages?.[0]?.id;
  async function loadOlder() {
    if (!oldestId || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await request(`&beforeId=${oldestId}`);
      heightBeforePrepend.current = scroller.current?.scrollHeight || 0;
      setMessages((current) => mergeMessages(current || [], data.messages));
      setPeople((known) => ({ ...known, ...data.people }));
      // Портал может вернуть больше LIMIT, но не меньше, пока история не кончилась.
      setHasOlder(data.messages.length >= MESSAGES_PAGE);
    } catch {
      setError('Не удалось загрузить более ранние сообщения.');
    } finally {
      setLoadingOlder(false);
    }
  }

  // Добавленная сверху история сдвигает всё вниз: возвращаем читателя на то же сообщение.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box || !heightBeforePrepend.current) return;
    box.scrollTop += box.scrollHeight - heightBeforePrepend.current;
    heightBeforePrepend.current = 0;
  }, [oldestId]);

  const newestId = messages?.at(-1)?.id;
  useEffect(() => {
    if (stickToBottom.current) bottom.current?.scrollIntoView({ block: 'end' });
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
      stickToBottom.current = true;
      load();
      onSent();
    } catch {
      // Черновик остаётся в поле: текст не теряется, можно отправить ещё раз.
      setError('Сообщение не отправилось. Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  async function upload(file: File, caption = '') {
    if (file.size > MAX_FILE_SIZE) {
      setError(`Файл «${file.name}» больше ${formatBytes(MAX_FILE_SIZE)}.`);
      return false;
    }
    setSending(true);
    setError('');
    try {
      const body = new FormData();
      body.set('dialogId', dialog.id);
      body.set('file', file);
      if (caption) body.set('message', caption);
      const response = await fetch('/api/messenger/files', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      stickToBottom.current = true;
      load();
      onSent();
      return true;
    } catch {
      setError(`Не удалось отправить «${file.name}». Попробуйте ещё раз.`);
      return false;
    } finally {
      setSending(false);
    }
  }

  // Подпись из поля ввода уходит с первым файлом, как в самом Битриксе.
  async function sendFiles(files: File[]) {
    let caption = draft.trim();
    for (const file of files) {
      if (!(await upload(file, caption))) return;
      if (caption) setDraft('');
      caption = '';
    }
  }

  useEffect(() => {
    setCanRecord(typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices));
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Диалог закрыт посреди записи: микрофон отпускаем, запись не отправляем.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function startRecording() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Firefox пишет ogg, Safari mp4, Chrome только webm: берём лучшее из поддерживаемого.
      const mimeType = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
    } catch {
      setError('Нет доступа к микрофону. Разрешите его в настройках браузера.');
    }
  }

  function finishRecording(send: boolean) {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((track) => track.stop());
      const type = recorder.mimeType || 'audio/webm';
      if (send && chunks.current.length) {
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const stamp = new Date()
          .toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
          .replace(',', '')
          .replace(':', '-');
        void upload(new File(chunks.current, `${VOICE_NAME} ${stamp}.${ext}`, { type }));
      }
      chunks.current = [];
    };
    recorder.stop();
    setRecording(false);
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
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4"
        aria-live="polite"
        onScroll={(event) => {
          const box = event.currentTarget;
          stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
      >
        {hasOlder && (
          <div className="flex justify-center">
            <Button
              variant="quiet"
              size="sm"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
            >
              {loadingOlder ? 'Загрузка' : 'Показать более ранние'}
            </Button>
          </div>
        )}
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
                  {message.text && (
                    <div className="break-words text-sm text-ink">
                      <BitrixText text={message.text} markdown />
                    </div>
                  )}
                  {message.files.map((file) => (
                    <FileView key={file.id} file={file} dialogId={dialog.id} />
                  ))}
                  {message.attach.map((attach, index) => (
                    <AttachView key={index} attach={attach} />
                  ))}
                  {!message.text && !message.files.length && !message.attach.length && (
                    <p className="text-sm text-ink-soft">Сообщение без текста</p>
                  )}
                  <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-ink-soft">
                    {message.edited && <span>изменено</span>}
                    <time dateTime={message.date}>{when(message.date)}</time>
                    {mine && readers && (
                      <ReadMark
                        readers={readersOf(message, readers)}
                        group={dialog.kind !== 'user'}
                      />
                    )}
                  </div>
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
      {recording ? (
        <div className="flex items-center gap-3 border-t border-line p-3">
          <Mic className="size-4 animate-pulse text-danger-text" strokeWidth={1.7} />
          <span className="flex-1 text-sm text-ink" role="timer">
            Запись {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </span>
          <Button
            variant="quiet"
            onClick={() => finishRecording(false)}
            aria-label="Отменить запись"
          >
            <X className="size-4" strokeWidth={1.7} />
          </Button>
          <Button onClick={() => finishRecording(true)} aria-label="Отправить голосовое">
            <Send className="size-4" strokeWidth={1.7} />
          </Button>
        </div>
      ) : (
        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            aria-label="Файлы"
            onChange={(event) => {
              const files = [...(event.target.files || [])];
              event.target.value = '';
              if (files.length) void sendFiles(files);
            }}
          />
          <Button
            variant="quiet"
            disabled={sending}
            onClick={() => picker.current?.click()}
            aria-label="Прикрепить файл"
          >
            <Paperclip className="size-4" strokeWidth={1.7} />
          </Button>
          <TextArea
            aria-label="Сообщение"
            placeholder="Сообщение"
            variant="boxed"
            rows={1}
            className="flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              const files = [...event.clipboardData.files];
              if (!files.length) return;
              event.preventDefault();
              void sendFiles(files);
            }}
            onKeyDown={(event) => {
              // Enter отправляет, Shift+Enter переносит строку, как в самом Битриксе.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {!draft.trim() && canRecord ? (
            <Button
              disabled={sending}
              onClick={() => void startRecording()}
              aria-label="Записать голосовое"
            >
              <Mic className="size-4" strokeWidth={1.7} />
            </Button>
          ) : (
            <Button type="submit" disabled={!draft.trim() || sending} aria-label="Отправить">
              <Send className="size-4" strokeWidth={1.7} />
            </Button>
          )}
        </form>
      )}
    </>
  );
}

function ReadMark({ readers, group }: { readers: Reader[]; group: boolean }) {
  const seen = readers.length > 0;
  const label = seen ? `Прочитано: ${readers.map((r) => r.name).join(', ')}` : 'Не прочитано';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-0.5 ${seen ? 'text-accent-text' : ''}`}
    >
      {seen ? (
        <CheckCheck className="size-3.5" strokeWidth={1.7} />
      ) : (
        <Check className="size-3.5" strokeWidth={1.7} />
      )}
      {group && seen && <span>{readers.length}</span>}
    </span>
  );
}

function FileView({ file, dialogId }: { file: MessageFile; dialogId: string }) {
  const src = `/api/messenger/file?dialogId=${encodeURIComponent(dialogId)}&fileId=${file.id}&name=${encodeURIComponent(file.name)}`;
  if (file.kind === 'image')
    return (
      <a href={src} target="_blank" rel="noreferrer" className="mt-1 block">
        <img src={src} alt={file.name} loading="lazy" className="max-h-64 max-w-full rounded-ui" />
      </a>
    );
  if (file.kind === 'audio')
    return (
      <div className="mt-1">
        <audio
          controls
          preload="none"
          src={src}
          aria-label={file.name}
          className="w-64 max-w-full"
        />
      </div>
    );
  if (file.kind === 'video')
    return (
      <video
        controls
        preload="metadata"
        src={src}
        aria-label={file.name}
        className="mt-1 max-h-64 max-w-full rounded-ui"
      />
    );
  return (
    <a
      href={`${src}&download=1`}
      className="mt-1 flex items-center gap-2 rounded-ui border border-line px-2 py-1.5 text-sm text-ink hover:bg-surface-2"
    >
      <FileText className="size-4 shrink-0 text-ink-soft" strokeWidth={1.7} />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-ink-soft">{formatBytes(file.size)}</span>
    </a>
  );
}

function AttachView({ attach }: { attach: Attach }) {
  return (
    <div className="mt-1 space-y-1 border-l-2 border-line pl-3 text-sm text-ink">
      {attach.description && <p className="text-xs text-ink-soft">{attach.description}</p>}
      {attach.blocks.map((block, index) => {
        if (block.type === 'text')
          return (
            <div key={index}>
              <BitrixText text={block.text} markdown />
            </div>
          );
        if (block.type === 'user')
          return (
            <p key={index} className="text-xs font-medium text-accent-text">
              {block.name}
            </p>
          );
        if (block.type === 'link')
          return (
            <div key={index}>
              <a
                href={safeHref(block.link)}
                target="_blank"
                rel="noreferrer"
                className="text-accent-text hover:underline"
              >
                {block.name}
              </a>
              {block.desc && <p className="text-xs text-ink-soft">{block.desc}</p>}
            </div>
          );
        if (block.type === 'grid')
          return (
            <dl key={index} className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
              {block.rows.map((row, rowIndex) => (
                <div key={rowIndex} className="contents">
                  <dt className="text-ink-soft">{row.name}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          );
        if (block.type === 'files')
          return (
            <p key={index} className="flex items-center gap-1 text-xs text-ink-soft">
              <Paperclip className="size-3.5" strokeWidth={1.7} />
              {block.names.join(', ')}
            </p>
          );
        return <hr key={index} className="border-line" />;
      })}
    </div>
  );
}

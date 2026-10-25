'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  CornerUpLeft,
  FileText,
  Pin,
  Users,
  Video,
  Forward,
  Heart,
  Mic,
  Paperclip,
  Pencil,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/monos/Avatar';
import { Button } from '@/components/monos/Button';
import { AlertDialog } from '@/components/monos/AlertDialog';
import { IconButton } from '@/components/monos/IconButton';
import { SearchField } from '@/components/monos/SearchField';
import { TextArea } from '@/components/monos/TextArea';
import BitrixText from '@/components/BitrixText';
import FileViewer from '@/components/FileViewer';
import LoadingState from '@/components/LoadingState';
import { ChatSettingsModal } from '@/components/messenger/ChatSettings';
import { ForwardModal } from '@/components/messenger/Dialogs';
import { AttachView, FileView, ReadMark } from '@/components/messenger/MessageParts';
import { PresenceDot } from '@/components/messenger/Presence';
import { useMessengerEvents, useRealtime } from '@/components/messenger/realtime';
import { usePolling, when } from '@/components/messenger/util';
import {
  MAX_FILE_SIZE,
  MESSAGES_PAGE,
  VOICE_NAME,
  applyMentions,
  fileUrl,
  formatBytes,
  mergeMessages,
  presenceText,
  quoteBlock,
  readersOf,
  type Dialog,
  type Message,
  type Person,
  type Presence,
  type Reader,
  type UserHit,
} from '@/lib/messenger';
import { bitrixPlainText } from '@/lib/bitrix-markup';
import { parseMessageNodes } from '@/lib/message-markdown';

// Пока жив SSE, обновление приходит событием, и опрос только подстраховывает.
const MESSAGES_POLL_MS = 5_000;
const MESSAGES_POLL_REALTIME_MS = 20_000;

export default function Conversation({
  dialog,
  dialogs,
  me,
  portal,
  onBack,
  onRead,
  onSent,
  onPin,
  onRenamed,
  onLeft,
}: {
  dialog: Dialog;
  dialogs: Dialog[];
  me: number;
  portal: string;
  onBack: () => void;
  onRead: (id: string) => void;
  onSent: () => void;
  onPin: () => void;
  onRenamed: (title: string) => void;
  onLeft: () => void;
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
  const [canPost, setCanPost] = useState(true);
  // Роль в чате: владелец и менеджер могут удалять чужие сообщения.
  const [role, setRole] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [canRecord, setCanRecord] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  // Файлы ждут в очереди до отправки: можно убрать лишний и дописать подпись.
  const [pending, setPending] = useState<File[]>([]);
  // Доля загрузки текущего файла на наш сервер; null когда ничего не отправляется.
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [notice, setNotice] = useState('');
  // Сообщение, у которого открыта панель действий (на телефоне вместо наведения).
  const [actionsFor, setActionsFor] = useState<number | null>(null);
  const [mentions, setMentions] = useState<{ id: number | 'all'; name: string }[]>([]);
  const [mention, setMention] = useState<{ query: string; from: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [members, setMembers] = useState<UserHit[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Message[] | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  // После перехода к найденному сообщению окно истории не доходит до последних.
  const [jumped, setJumped] = useState(false);
  const polls = useRef(0);
  const jumpedRef = useRef(false);
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
              canPost?: boolean;
              role?: string;
            }>)
          : Promise.reject(new Error(String(response.status))),
      ),
    [dialogId, me],
  );

  // Первый запрос берёт последние сообщения, дальше опрос идёт курсором
  // afterId (FIRST_ID портала) и тянет только новое, не затирая подгруженную историю.
  const load = useCallback(() => {
    // Каждый шестой опрос (раз в полминуты) перечитывает последнюю страницу целиком:
    // правки, удаления и лайки чужих сообщений курсором afterId не приходят.
    polls.current += 1;
    const after = polls.current % 6 === 0 && !jumpedRef.current ? 0 : newestRef.current;
    const latest = newestRef.current;
    void request(after ? `&afterId=${after}` : '')
      .then((data) => {
        setMessages((current) => mergeMessages(current || [], data.messages));
        setPeople((known) => ({ ...known, ...data.people }));
        if (data.readers) setReaders(data.readers);
        if (data.canPost !== undefined) setCanPost(data.canPost);
        if (data.role !== undefined) setRole(data.role);
        if (!latest) setHasOlder(data.messages.length >= MESSAGES_PAGE);
        // Пришло чужое сообщение в открытом диалоге: сразу прочитано.
        if (latest && data.messages.some((m) => m.id > latest && m.authorId !== me))
          onRead(dialogId);
        newestRef.current = Math.max(latest, ...data.messages.map((m) => m.id));
      })
      .catch(() => setError('Не удалось загрузить сообщения.'));
  }, [request, dialogId, me, onRead]);
  const realtime = useRealtime();
  usePolling(load, realtime ? MESSAGES_POLL_REALTIME_MS : MESSAGES_POLL_MS);

  // Событие по этому диалогу: новое сообщение подтягивается сразу, а правка, удаление
  // и лайк перечитывают страницу целиком (курсор afterId такие изменения не отдаёт).
  useMessengerEvents((event) => {
    if (event.dialogId !== dialog.id) return;
    if (event.kind !== 'add') polls.current = 5;
    load();
  });

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

  // Фото и видео всего диалога листаются в одном просмотрщике, по порядку сообщений.
  const media = useMemo(
    () =>
      (messages || []).flatMap((message) =>
        message.files.filter((file) => file.kind === 'image' || file.kind === 'video'),
      ),
    [messages],
  );
  const viewerIndex = media.findIndex((file) => file.id === viewingId);

  const newestId = messages?.at(-1)?.id;
  useEffect(() => {
    if (stickToBottom.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [newestId]);

  const nameOf = (message: Message) =>
    people[String(message.authorId)]?.name ||
    (message.authorId === me ? 'Я' : `Пользователь ${message.authorId}`);

  const json = { 'Content-Type': 'application/json' };

  async function send() {
    const raw = draft.trim();
    if ((!raw && !pending.length) || sending) return;
    setSending(true);
    setError('');
    try {
      if (editing) {
        const response = await fetch('/api/messenger/message', {
          method: 'PUT',
          headers: json,
          body: JSON.stringify({ messageId: editing.id, text: raw }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const id = editing.id;
        setMessages(
          (current) =>
            current && current.map((m) => (m.id === id ? { ...m, text: raw, edited: true } : m)),
        );
        setEditing(null);
        setDraft('');
        return;
      }
      const text =
        (replyTo ? quoteBlock(nameOf(replyTo), replyTo) : '') + applyMentions(raw, mentions);
      if (pending.length) await sendPending(text);
      else {
        const response = await fetch('/api/messenger/messages', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ dialogId: dialog.id, text }),
        });
        if (!response.ok) throw new Error(String(response.status));
      }
      setDraft('');
      setReplyTo(null);
      setMentions([]);
      stickToBottom.current = true;
      if (jumpedRef.current) showLatest();
      else load();
      onSent();
    } catch {
      // Черновик остаётся в поле: текст не теряется, можно отправить ещё раз.
      setError(
        editing
          ? 'Не удалось изменить сообщение: править можно только свои и недолго после отправки.'
          : 'Сообщение не отправилось. Попробуйте ещё раз.',
      );
    } finally {
      setSending(false);
    }
  }

  // Лайк виден сразу, а откатывается, если портал отказал.
  async function toggleLike(message: Message) {
    const liked = message.likes.includes(me);
    const apply = (likes: number[]) =>
      setMessages(
        (current) => current && current.map((m) => (m.id === message.id ? { ...m, likes } : m)),
      );
    apply(liked ? message.likes.filter((id) => id !== me) : [...message.likes, me]);
    const response = await fetch('/api/messenger/message', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ messageId: message.id, action: liked ? 'unlike' : 'like' }),
    }).catch(() => null);
    if (!response?.ok) apply(message.likes);
  }

  function startEdit(message: Message) {
    setReplyTo(null);
    setEditing(message);
    setDraft(message.text);
    inputRef.current?.focus();
  }

  function startReply(message: Message) {
    setEditing(null);
    setReplyTo(message);
    inputRef.current?.focus();
  }

  async function confirmDelete() {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    const response = await fetch('/api/messenger/message', {
      method: 'DELETE',
      headers: json,
      body: JSON.stringify({ messageId: target.id }),
    }).catch(() => null);
    if (!response?.ok) {
      setError('Не удалось удалить сообщение: удалять можно только свои и недолго после отправки.');
      return;
    }
    // Как в самом Битриксе: на месте сообщения остаётся пометка об удалении.
    setMessages(
      (current) =>
        current &&
        current.map((m) =>
          m.id === target.id
            ? { ...m, text: 'Это сообщение было удалено.', files: [], attach: [], likes: [] }
            : m,
        ),
    );
  }

  // Пересылка текстом с цитатой: REST не умеет пересылать сообщение целиком, а
  // файлы пришлось бы заново загружать, поэтому от файлов остаются имена.
  async function forwardTo(target: Dialog) {
    const message = forwarding;
    setForwarding(null);
    if (!message) return;
    const text = quoteBlock(nameOf(message), message, 'Переслано от ');
    // С файлами пересылает сервер: он скачивает их из этого чата и загружает в целевой.
    const response = await (
      message.files.length
        ? fetch('/api/messenger/forward', {
            method: 'POST',
            headers: json,
            body: JSON.stringify({
              fromDialogId: dialog.id,
              toDialogId: target.id,
              text,
              files: message.files.map((file) => ({ id: file.id, name: file.name })),
            }),
          })
        : fetch('/api/messenger/messages', {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ dialogId: target.id, text }),
          })
    ).catch(() => null);
    if (response?.ok) {
      setNotice(`Переслано в «${target.title}»`);
      onSent();
    } else setError('Не удалось переслать сообщение.');
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Упоминание: после @ в чате предлагаем участников. В поле оно остаётся @Именем,
  // а тегом Битрикса становится при отправке.
  const lastTyping = useRef(0);

  function onDraftChange(value: string, caret: number) {
    setDraft(value);
    // «Печатает…» у собеседников: сигнал не чаще раза в четыре секунды.
    if (value.trim() && !editing && Date.now() - lastTyping.current > 4000) {
      lastTyping.current = Date.now();
      void fetch('/api/messenger/typing', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ dialogId: dialog.id }),
      }).catch(() => {});
    }
    if (dialog.kind === 'user') return;
    const match = /(?:^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    if (!match) {
      setMention(null);
      return;
    }
    setMention({ query: match[1], from: caret - match[1].length - 1 });
    setMentionIndex(0);
    if (members === null) {
      setMembers([]);
      void fetch(`/api/messenger/users?dialogId=${encodeURIComponent(dialog.id)}`)
        .then((response) => (response.ok ? response.json() : { users: [] }))
        .then((data) => setMembers(data.users))
        .catch(() => setMembers([]));
    }
  }

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const needle = mention.query.toLocaleLowerCase('ru');
    const everyone: { id: number | 'all'; name: string; presence?: Presence }[] = [
      { id: 'all', name: 'Все' },
    ];
    return [...everyone, ...(members || []).filter((user) => user.id !== me)]
      .filter((user) => user.name.toLocaleLowerCase('ru').includes(needle))
      .slice(0, 6);
  }, [mention, members, me]);

  function pickMention(user: { id: number | 'all'; name: string }) {
    if (!mention) return;
    const caret = inputRef.current?.selectionStart ?? draft.length;
    const insert = `@${user.name} `;
    setDraft(draft.slice(0, mention.from) + insert + draft.slice(caret));
    setMentions((current) =>
      current.some((item) => item.id === user.id) ? current : [...current, user],
    );
    setMention(null);
    const position = mention.from + insert.length;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  }

  // Поиск по диалогу: запрос уходит после паузы в наборе.
  useEffect(() => {
    const needle = searchQuery.trim();
    if (!searchOpen || needle.length < 2) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(
        `/api/messenger/search?dialogId=${encodeURIComponent(dialog.id)}&q=${encodeURIComponent(needle)}`,
        { signal: controller.signal },
      )
        .then((response) => (response.ok ? response.json() : { messages: [], people: {} }))
        .then((data) => {
          setResults([...data.messages].reverse());
          setPeople((known) => ({ ...known, ...data.people }));
        })
        .catch(() => {});
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, searchOpen, dialog.id]);

  // Переход к найденному: берём страницу истории, оканчивающуюся этим сообщением.
  async function jumpTo(id: number) {
    try {
      const data = await request(`&beforeId=${id + 1}`);
      setMessages(data.messages);
      setPeople((known) => ({ ...known, ...data.people }));
      newestRef.current = Math.max(...data.messages.map((m) => m.id));
      setHasOlder(data.messages.length >= MESSAGES_PAGE);
      stickToBottom.current = false;
      jumpedRef.current = true;
      setJumped(true);
      setHighlightId(id);
      setSearchOpen(false);
    } catch {
      setError('Не удалось открыть найденное сообщение.');
    }
  }

  function showLatest() {
    jumpedRef.current = false;
    setJumped(false);
    setMessages(null);
    newestRef.current = 0;
    stickToBottom.current = true;
    load();
  }

  useEffect(() => {
    if (highlightId === null) return;
    document.getElementById(`message-${highlightId}`)?.scrollIntoView({ block: 'center' });
    const timer = window.setTimeout(() => setHighlightId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightId, messages]);

  // XMLHttpRequest, а не fetch: только он отдаёт ход загрузки файла.
  function postFile(file: File, caption: string): Promise<boolean> {
    return new Promise((resolve) => {
      const body = new FormData();
      body.set('dialogId', dialog.id);
      body.set('file', file);
      if (caption) body.set('message', caption);
      const request = new XMLHttpRequest();
      request.open('POST', '/api/messenger/files');
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
      };
      request.onload = () => resolve(request.status >= 200 && request.status < 300);
      request.onerror = () => resolve(false);
      setProgress(0);
      request.send(body);
    });
  }

  function addFiles(files: File[]) {
    const tooBig = files.find((file) => file.size > MAX_FILE_SIZE);
    if (tooBig) setError(`Файл «${tooBig.name}» больше ${formatBytes(MAX_FILE_SIZE)}.`);
    const fits = files.filter((file) => file.size <= MAX_FILE_SIZE);
    if (fits.length) setPending((current) => [...current, ...fits]);
  }

  // Голосовое уходит сразу: проверять в нём нечего.
  async function upload(file: File) {
    setSending(true);
    setError('');
    try {
      if (!(await postFile(file, ''))) throw new Error('upload');
      stickToBottom.current = true;
      load();
      onSent();
    } catch {
      setError(`Не удалось отправить «${file.name}». Попробуйте ещё раз.`);
    } finally {
      setProgress(null);
      setSending(false);
    }
  }

  // Подпись уходит с первым файлом, как в самом Битриксе. Отправленные файлы
  // покидают очередь сразу: при сбое остаются только неотправленные.
  async function sendPending(caption: string) {
    let first = true;
    for (const file of pending) {
      if (!(await postFile(file, first ? caption : ''))) {
        setProgress(null);
        throw new Error(file.name);
      }
      first = false;
      setPending((current) => current.filter((item) => item !== file));
    }
    setProgress(null);
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
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = [...event.dataTransfer.files];
        if (files.length && canPost) addFiles(files);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-ink-soft bg-canvas/80 text-sm text-ink">
          Отпустите файлы, чтобы прикрепить
        </div>
      )}
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
        <span className="relative shrink-0">
          <Avatar name={dialog.title} src={dialog.avatar} size="sm" />
          <PresenceDot
            presence={dialog.presence}
            className="absolute -right-0.5 -bottom-0.5 border-2 border-canvas"
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-ink">{dialog.title}</h2>
          {presenceText(dialog.presence) && (
            <p
              className={`truncate text-xs ${
                dialog.presence?.state === 'online' ? 'text-success-text' : 'text-ink-soft'
              }`}
            >
              {presenceText(dialog.presence)}
            </p>
          )}
        </div>
        {link && (
          <Link href={link} className="shrink-0 text-xs text-accent-text hover:underline">
            {dialog.kind === 'task' ? 'Открыть задачу' : 'Открыть проект'}
          </Link>
        )}
        {portal && (
          // Звонки и видеоконференции REST создавать не умеет: они живут в самом Битриксе.
          <a
            href={`https://${portal}/online/?IM_DIALOG=${encodeURIComponent(dialog.id)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Открыть диалог в Битриксе (там есть звонки)"
            title="Открыть в Битриксе: там есть звонки и видеоконференции"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-ui text-ink-soft transition-colors duration-fast hover:bg-surface hover:text-ink max-sm:size-11"
          >
            <Video className="size-4" strokeWidth={1.7} />
          </a>
        )}
        {dialog.kind === 'chat' && /^chat\d+$/.test(dialog.id) && (
          <IconButton label="Настройки чата" variant="ghost" onClick={() => setSettingsOpen(true)}>
            <Users className="size-4" strokeWidth={1.7} />
          </IconButton>
        )}
        <IconButton
          label={dialog.pinned ? 'Открепить диалог' : 'Закрепить диалог'}
          variant="ghost"
          pressed={Boolean(dialog.pinned)}
          onClick={onPin}
        >
          <Pin className={`size-4 ${dialog.pinned ? 'fill-current' : ''}`} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          label="Поиск по сообщениям"
          variant="ghost"
          pressed={searchOpen}
          onClick={() => setSearchOpen((value) => !value)}
        >
          <Search className="size-4" strokeWidth={1.7} />
        </IconButton>
      </div>
      {searchOpen && (
        <div className="space-y-2 border-b border-line p-3">
          <SearchField
            id="message-search"
            label="Поиск по сообщениям"
            placeholder="Поиск по сообщениям (от двух букв)"
            size="sm"
            value={searchQuery}
            onChange={setSearchQuery}
          />
          {results !== null && (
            <ul className="max-h-56 overflow-y-auto" aria-label="Найденные сообщения">
              {results.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => void jumpTo(message.id)}
                    className="block w-full rounded-ui px-2 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs text-ink-soft">
                      <span className="truncate">{nameOf(message)}</span>
                      <time dateTime={message.date}>{when(message.date)}</time>
                    </span>
                    <span className="line-clamp-2 text-sm text-ink">
                      {bitrixPlainText(message.text, parseMessageNodes) || 'Вложение'}
                    </span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="p-2 text-xs text-ink-soft">Ничего не найдено</li>
              )}
            </ul>
          )}
        </div>
      )}
      <div
        ref={scroller}
        // Сверху запас под панель действий: она стоит над сообщением, и у самого первого
        // иначе уходила бы под шапку диалога.
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pt-10 pb-4"
        aria-live="polite"
        onScroll={(event) => {
          const box = event.currentTarget;
          stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
      >
        {jumped && (
          <div className="sticky top-0 z-10 flex justify-center">
            <Button variant="secondary" size="sm" onClick={showLatest}>
              К последним сообщениям
            </Button>
          </div>
        )}
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
            const liked = message.likes.includes(me);
            const deleted = message.text === 'Это сообщение было удалено.';
            const seen = readers ? readersOf(message, readers) : [];
            return (
              <div
                key={message.id}
                id={`message-${message.id}`}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  onClick={() =>
                    setActionsFor((current) => (current === message.id ? null : message.id))
                  }
                  className={`group relative max-w-[80%] rounded-ui border px-3 py-2 ${
                    highlightId === message.id ? 'border-ink' : 'border-line'
                  } ${mine ? 'bg-surface-2' : 'bg-surface'}`}
                >
                  {!deleted && (
                    <div
                      className={`absolute right-2 bottom-full z-10 mb-1 gap-0.5 rounded-ui border border-line bg-canvas p-0.5 shadow-overlay group-focus-within:flex group-hover:flex ${
                        actionsFor === message.id ? 'flex' : 'hidden'
                      }`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconButton
                        label="Ответить"
                        variant="ghost"
                        size="sm"
                        className="max-sm:h-9 max-sm:w-9"
                        onClick={() => startReply(message)}
                      >
                        <CornerUpLeft className="size-3.5" strokeWidth={1.7} />
                      </IconButton>
                      <IconButton
                        label={liked ? 'Убрать лайк' : 'Нравится'}
                        variant="ghost"
                        size="sm"
                        className="max-sm:h-9 max-sm:w-9"
                        pressed={liked}
                        onClick={() => void toggleLike(message)}
                      >
                        <Heart
                          className={`size-3.5 ${liked ? 'fill-current text-accent-text' : ''}`}
                          strokeWidth={1.7}
                        />
                      </IconButton>
                      <IconButton
                        label="Переслать"
                        variant="ghost"
                        size="sm"
                        className="max-sm:h-9 max-sm:w-9"
                        onClick={() => setForwarding(message)}
                      >
                        <Forward className="size-3.5" strokeWidth={1.7} />
                      </IconButton>
                      {mine && message.text && (
                        <IconButton
                          label="Изменить"
                          variant="ghost"
                          size="sm"
                          className="max-sm:h-9 max-sm:w-9"
                          onClick={() => startEdit(message)}
                        >
                          <Pencil className="size-3.5" strokeWidth={1.7} />
                        </IconButton>
                      )}
                      {(mine || role === 'owner' || role === 'manager') && (
                        <IconButton
                          label="Удалить"
                          variant="ghost"
                          size="sm"
                          className="max-sm:h-9 max-sm:w-9"
                          onClick={() => setDeleting(message)}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.7} />
                        </IconButton>
                      )}
                    </div>
                  )}
                  {!mine && dialog.kind !== 'user' && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-accent-text">
                      <PresenceDot
                        presence={people[String(message.authorId)]?.presence}
                        className="size-2"
                      />
                      {people[String(message.authorId)]?.name || `Пользователь ${message.authorId}`}
                    </p>
                  )}
                  {message.text && (
                    <div className="break-words text-sm text-ink">
                      <BitrixText text={message.text} markdown />
                    </div>
                  )}
                  {message.files.map((file) => (
                    <FileView
                      key={file.id}
                      file={file}
                      dialogId={dialog.id}
                      onOpen={setViewingId}
                    />
                  ))}
                  {message.attach.map((attach, index) => (
                    <AttachView key={index} attach={attach} />
                  ))}
                  {!message.text && !message.files.length && !message.attach.length && (
                    <p className="text-sm text-ink-soft">Сообщение без текста</p>
                  )}
                  <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-ink-soft">
                    {message.likes.length > 0 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleLike(message);
                        }}
                        aria-pressed={liked}
                        aria-label={`Нравится: ${message.likes.length}`}
                        className="mr-auto inline-flex items-center gap-1 rounded-ui border border-line px-1.5 py-0.5"
                      >
                        <Heart
                          className={`size-3 ${liked ? 'fill-current text-accent-text' : ''}`}
                          strokeWidth={1.7}
                        />
                        {message.likes.length}
                      </button>
                    )}
                    {message.edited && <span>изменено</span>}
                    <time dateTime={message.date}>{when(message.date)}</time>
                    {mine && readers && dialog.kind !== 'channel' && (
                      <ReadMark
                        readers={seen}
                        unread={readers.filter((reader) => reader.messageId < message.id)}
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
      {!canPost ? (
        <p className="border-t border-line p-3 text-center text-sm text-ink-soft">
          В этом канале писать могут только администраторы
        </p>
      ) : recording ? (
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
        <div className="relative border-t border-line">
          {(replyTo || editing) && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-soft">
              <span className="min-w-0 flex-1 truncate">
                {editing
                  ? 'Редактирование сообщения'
                  : `Ответ для ${nameOf(replyTo!)}: ${bitrixPlainText(replyTo!.text, parseMessageNodes) || 'вложение'}`}
              </span>
              <IconButton
                label="Отменить"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReplyTo(null);
                  setEditing(null);
                  if (editing) setDraft('');
                }}
              >
                <X className="size-3.5" strokeWidth={1.7} />
              </IconButton>
            </div>
          )}
          {pending.length > 0 && (
            <ul
              className="flex flex-wrap gap-2 border-b border-line px-3 py-2"
              aria-label="Прикреплённые файлы"
            >
              {pending.map((file, index) => (
                <PendingFile
                  key={`${file.name}-${file.size}-${index}`}
                  file={file}
                  disabled={sending}
                  onRemove={() => setPending((current) => current.filter((item) => item !== file))}
                />
              ))}
            </ul>
          )}
          {progress !== null && (
            <div
              role="progressbar"
              aria-label="Отправка файла"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1 bg-surface-2"
            >
              <div className="h-full bg-ink transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          )}
          {mention && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Упомянуть"
              className="absolute bottom-full left-3 z-10 mb-1 w-64 rounded-ui border border-line bg-canvas p-1 shadow-overlay"
            >
              {suggestions.map((user, index) => (
                <li
                  key={user.id}
                  role="option"
                  aria-selected={index === mentionIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickMention(user)}
                  className={`cursor-pointer rounded-ui px-2 py-1.5 text-sm text-ink ${
                    index === mentionIndex ? 'bg-surface-2' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {user.presence ? (
                      <PresenceDot presence={user.presence} className="size-2" />
                    ) : null}
                    {user.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex items-end gap-2 p-3"
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
                if (files.length) addFiles(files);
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
              // textarea по умолчанию строчный: под ним остаётся зазор в 7 px, обёртка выше
              // поля, и поле висит над кнопками. block убирает зазор, а высота в одну строку
              // равна кнопкам (min-h-9, на телефоне min-h-11).
              className="flex-1 [&_textarea]:block [&_textarea]:min-h-9 [&_textarea]:py-1.5 max-sm:[&_textarea]:min-h-11"
              ref={inputRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value, event.target.selectionStart)}
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (!files.length) return;
                event.preventDefault();
                addFiles(files);
              }}
              onKeyDown={(event) => {
                if (mention && suggestions.length) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : suggestions.length - 1;
                    setMentionIndex((index) => (index + step) % suggestions.length);
                    return;
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    pickMention(suggestions[mentionIndex] || suggestions[0]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    setMention(null);
                    return;
                  }
                }
                if (event.key === 'Escape' && (replyTo || editing)) {
                  setReplyTo(null);
                  if (editing) setDraft('');
                  setEditing(null);
                  return;
                }
                // Enter отправляет, Shift+Enter переносит строку, как в самом Битриксе.
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {!draft.trim() && !pending.length && canRecord ? (
              <Button
                disabled={sending}
                onClick={() => void startRecording()}
                aria-label="Записать голосовое"
              >
                <Mic className="size-4" strokeWidth={1.7} />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={(!draft.trim() && !pending.length) || sending}
                aria-label="Отправить"
              >
                <Send className="size-4" strokeWidth={1.7} />
              </Button>
            )}
          </form>
        </div>
      )}
      {notice && (
        <p role="status" className="px-4 pb-1 text-xs text-ink-soft">
          {notice}
        </p>
      )}
      <AlertDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        title="Удалить сообщение?"
        description="Сообщение удалится у всех участников чата."
        confirmLabel="Удалить"
      />
      <ChatSettingsModal
        open={settingsOpen}
        dialog={dialog}
        me={me}
        onClose={() => setSettingsOpen(false)}
        onRenamed={(title) => {
          setSettingsOpen(false);
          onRenamed(title);
        }}
        onLeft={() => {
          setSettingsOpen(false);
          onLeft();
        }}
      />
      <ForwardModal
        open={forwarding !== null}
        dialogs={dialogs}
        onPick={(target) => void forwardTo(target)}
        onClose={() => setForwarding(null)}
      />
      {viewerIndex >= 0 && (
        <FileViewer
          items={media.map((file) => ({
            id: file.id,
            name: file.name,
            kind: file.kind as 'image' | 'video',
            src: fileUrl(dialog.id, file),
            downloadSrc: fileUrl(dialog.id, file, true),
          }))}
          index={viewerIndex}
          onIndex={(index) => setViewingId(media[index].id)}
          onClose={() => setViewingId(null)}
        />
      )}
    </div>
  );
}

// Файл в очереди: у картинки превью, у остальных значок. Превью живёт, пока файл в очереди.
function PendingFile({
  file,
  disabled,
  onRemove,
}: {
  file: File;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <li className="flex max-w-56 items-center gap-2 rounded-ui border border-line px-2 py-1 text-xs text-ink">
      {preview ? (
        <img src={preview} alt="" className="size-8 shrink-0 rounded-ui object-cover" />
      ) : (
        <FileText className="size-4 shrink-0 text-ink-soft" strokeWidth={1.7} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{file.name}</span>
        <span className="text-ink-soft">{formatBytes(file.size)}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Убрать ${file.name}`}
        className="shrink-0 text-ink-soft hover:text-ink disabled:opacity-30"
      >
        <X className="size-3.5" strokeWidth={1.7} />
      </button>
    </li>
  );
}

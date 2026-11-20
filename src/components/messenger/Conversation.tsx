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
  ListPlus,
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
import QuickCreateTask from '@/components/QuickCreateTask';
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
import { dateLocale, t } from '@/lib/i18n';

// Пока жив SSE, обновление приходит событием, и опрос только подстраховывает.
const MESSAGES_POLL_MS = 5_000;
const MESSAGES_POLL_REALTIME_MS = 20_000;

// Черновик и очередь файлов каждого диалога живут дольше переписки: она размонтируется
// при переходе в другой чат, и набранный текст с прикреплёнными файлами терялся бы.
// ponytail: только в памяти вкладки, после перезагрузки страницы черновиков нет.
type Mention = { id: number | 'all'; name: string };
const drafts = new Map<string, { text: string; files: File[]; mentions?: Mention[] }>();

// Последняя страница каждого открытого чата: при возврате в чат она рисуется сразу, а не после
// двух запросов (к нам и к порталу), и первая загрузка тут же заменяет её свежей версией.
// Хранится только последняя страница: первая загрузка заменяет ровно её диапазон.
type Snapshot = {
  messages: Message[];
  people: Record<string, Person>;
  readers: Reader[] | null;
  canPost: boolean;
  role: string;
  hasOlder: boolean;
};
const snapshots = new Map<string, Snapshot>();
const SNAPSHOT_LIMIT = 40;
function rememberSnapshot(id: string, snapshot: Snapshot) {
  // Порядок вставки работает как очередь: свежий чат в конец, самый давний уходит первым.
  snapshots.delete(id);
  snapshots.set(id, snapshot);
  if (snapshots.size > SNAPSHOT_LIMIT) snapshots.delete(snapshots.keys().next().value!);
}
// Сколько отправок идёт в каждом диалоге: вернувшаяся переписка не даёт отправить то же
// второй раз. Счётчик, а не флаг: голосовое и текст могут идти одновременно.
const sendingDialogs = new Map<string, number>();

// Отправка могла закончиться, когда переписку уже открыли заново: открытая копия тоже
// должна убрать отправленное, поэтому подтверждения раздаются подписчикам.
type Sent = { dialogId: string; text?: string; file?: File; requeued?: File; finished?: boolean };
const sentListeners = new Set<(sent: Sent) => void>();

function startSending(dialogId: string) {
  sendingDialogs.set(dialogId, (sendingDialogs.get(dialogId) || 0) + 1);
}

function finishSending(dialogId: string) {
  const left = (sendingDialogs.get(dialogId) || 1) - 1;
  if (left) {
    sendingDialogs.set(dialogId, left);
    return;
  }
  sendingDialogs.delete(dialogId);
  for (const listener of sentListeners) listener({ dialogId, finished: true });
}

function forgetSent(dialogId: string, text: string) {
  const saved = drafts.get(dialogId);
  if (saved?.text === text) drafts.set(dialogId, { ...saved, text: '' });
  for (const listener of sentListeners) listener({ dialogId, text });
}

function forgetFile(dialogId: string, file: File) {
  const saved = drafts.get(dialogId);
  if (saved) drafts.set(dialogId, { ...saved, files: saved.files.filter((item) => item !== file) });
  for (const listener of sentListeners) listener({ dialogId, file });
}

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
  onRead: (id: string, messageId: number) => Promise<boolean>;
  onSent: () => void;
  onPin: () => void;
  onRenamed: (title: string) => void;
  onLeft: () => void;
}) {
  const cached = snapshots.get(dialog.id);
  const [messages, setMessages] = useState<Message[] | null>(cached?.messages ?? null);
  const [people, setPeople] = useState<Record<string, Person>>(cached?.people ?? {});
  const [draft, setDraft] = useState(() => drafts.get(dialog.id)?.text ?? '');
  // Выбранные упоминания живут вместе с черновиком, иначе @Имя ушло бы простым текстом.
  const [mentions, setMentions] = useState<Mention[]>(() => drafts.get(dialog.id)?.mentions ?? []);
  // Правка занимает поле ввода: набранное новое сообщение откладываем и возвращаем, когда
  // правку закончили или отменили.
  const beforeEdit = useRef('');
  const beforeEditMentions = useRef<Mention[]>([]);
  const editingRef = useRef<Message | null>(null);
  const [sending, setSending] = useState(() => sendingDialogs.has(dialog.id));
  const beginSend = () => {
    setSending(true);
    startSending(dialog.id);
  };
  const [error, setError] = useState('');
  const [hasOlder, setHasOlder] = useState(cached?.hasOlder ?? false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // null пока портал не ответил: галочки без данных не рисуем.
  const [readers, setReaders] = useState<Reader[] | null>(cached?.readers ?? null);
  const [canPost, setCanPost] = useState(cached?.canPost ?? true);
  const canPostRef = useRef(true);
  useEffect(() => {
    canPostRef.current = canPost;
  }, [canPost]);
  // Роль в чате: владелец и менеджер могут удалять чужие сообщения.
  const [role, setRole] = useState(cached?.role ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [canRecord, setCanRecord] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Фрагменты у каждой записи свои: остановка прошлой заканчивается асинхронно, и общий
  // буфер смешал бы её со следующей записью.
  const chunks = useRef(new WeakMap<MediaRecorder, Blob[]>());
  const picker = useRef<HTMLInputElement>(null);
  // Файлы ждут в очереди до отправки: можно убрать лишний и дописать подпись.
  const [pending, setPending] = useState<File[]>(() => drafts.get(dialog.id)?.files ?? []);
  useEffect(() => {
    const listener = (sent: Sent) => {
      if (sent.dialogId !== dialog.id) return;
      if (sent.text !== undefined) setDraft((current) => (current === sent.text ? '' : current));
      if (sent.file) setPending((current) => current.filter((item) => item !== sent.file));
      if (sent.requeued) setPending((current) => [...current, sent.requeued as File]);
      if (sent.finished) setSending(false);
    };
    sentListeners.add(listener);
    return () => {
      sentListeners.delete(listener);
    };
  }, [dialog.id]);
  // Доля загрузки текущего файла на наш сервер; null когда ничего не отправляется.
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Поле растёт по тексту: с rows=1 перенос через Shift+Enter прятал первую строку под
  // скролл, и казалось, что строка одна. Потолок задаёт max-h у поля, дальше скролл.
  // field-sizing: content это делает сам, но Firefox его не знает.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
  }, [draft]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useEffect(() => {
    // Во время правки в поле текст старого сообщения: сохраняем отложенный черновик.
    const text = editing ? beforeEdit.current : draft;
    const saved = editing ? beforeEditMentions.current : mentions;
    if (text || pending.length) drafts.set(dialog.id, { text, files: pending, mentions: saved });
    else drafts.delete(dialog.id);
  }, [dialog.id, draft, pending, editing, mentions]);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [taskFrom, setTaskFrom] = useState<Message | null>(null);
  const [notice, setNotice] = useState('');
  // Сообщение, у которого открыта панель действий (на телефоне вместо наведения).
  const [actionsFor, setActionsFor] = useState<number | null>(null);
  const [mention, setMention] = useState<{ query: string; from: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [members, setMembers] = useState<UserHit[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Message[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
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

  // Новое чужое сообщение ждёт отметки до конца догоняющего прохода. Флаг живёт между
  // загрузками: если следующая страница упала, отметка не теряется.
  const sawNew = useRef(false);
  // Идёт загрузка истории: отметки прочитанного ждут её конца.
  const loading = useRef(false);
  // Отметка не прошла (портал или связь): ждёт следующего прохода опроса.
  // Без показанного сообщения границы нет, а im.dialog.read без неё погасил бы и то, что
  // придёт в эту секунду: пустой истории читать нечего.
  const readNow = useCallback(
    () =>
      newestRef.current &&
      void onRead(dialogId, newestRef.current).then((ok) => {
        if (!ok) sawNew.current = true;
      }),
    [onRead, dialogId],
  );
  // Сообщение пришло, пока вкладка скрыта: прочитанным его отметим, когда человек вернётся.
  const unseen = useRef(false);
  // То же, пока человек читает старую часть истории (отлистал вверх или прыгнул к
  // найденному): отметка ждёт, когда он вернётся к последним сообщениям.
  const markSeen = useCallback(() => {
    if (document.visibilityState === 'visible' && stickToBottom.current && !jumpedRef.current)
      readNow();
    else unseen.current = true;
  }, [readNow]);
  const flushSeen = () => {
    // Программная прокрутка в скрытой вкладке тоже вызывает onScroll: без проверки
    // видимости сообщения отмечались бы прочитанными до возвращения человека.
    if (document.visibilityState !== 'visible') return;
    if (!unseen.current || !stickToBottom.current || jumpedRef.current) return;
    unseen.current = false;
    // Идёт догрузка: отметим в её конце, когда всё загруженное уже на экране.
    if (loading.current) {
      sawNew.current = true;
      return;
    }
    readNow();
  };
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !unseen.current) return;
      if (!stickToBottom.current || jumpedRef.current) return;
      unseen.current = false;
      if (loading.current) {
        sawNew.current = true;
        return;
      }
      readNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [readNow]);
  // Открытый непрочитанный диалог (кликом, по ссылке уведомления или после обновления
  // страницы) отмечается прочитанным, когда последние сообщения загрузились и видны, а не
  // при открытии: зависшая или упавшая загрузка не должна гасить счётчик.
  const unreadAtOpen = useRef(dialog.unread > 0);

  // Первый запрос берёт последние сообщения, дальше опрос идёт курсором
  // afterId (FIRST_ID портала) и тянет только новое, не затирая подгруженную историю.
  // Загрузки идут по одной: поздний ответ старого опроса иначе откатывал бы курсор
  // и затирал свежую версию сообщения. Вызов во время загрузки ставит ещё один проход.
  const again = useRef(false);
  // Прыжок к найденному и возврат к последним заменяют окно истории: ответ загрузки,
  // начатой до этого, в новое окно не попадает.
  const generation = useRef(0);
  const loaded = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    try {
      // Одна страница: без курсора это последние сообщения, и тогда она заменяет свой
      // диапазон целиком (удалённое на портале исчезает), с afterId только новое.
      const page = async (after: number) => {
        const gen = generation.current;
        const data = await request(after ? `&afterId=${after}` : '');
        if (gen !== generation.current) return 0;
        const first = !loaded.current;
        // История опустела на портале: начатая до этого подгрузка старых страниц не должна
        // вернуть удалённое.
        if (!after && !data.messages.length && newestRef.current) generation.current += 1;
        setMessages((current) => mergeMessages(current || [], data.messages, !after));
        // История снова грузится: прошлое предупреждение о сбое больше не правда.
        setError((current) => (current === t('Не удалось загрузить сообщения.') ? '' : current));
        setPeople((known) => ({ ...known, ...data.people }));
        if (data.readers) setReaders(data.readers);
        if (data.canPost !== undefined) setCanPost(data.canPost);
        if (data.role !== undefined) setRole(data.role);
        if (first) setHasOlder(data.messages.length >= MESSAGES_PAGE);
        const latest = newestRef.current;
        // Пришло чужое сообщение в открытом диалоге: прочитано, если его видно. Пустой
        // до этого диалог тоже считается: курсор у него ноль, но история уже загружена.
        // Отмечаем после прохода целиком: im.dialog.read гасит всё, в том числе страницы,
        // которые ещё не догнаны.
        if (!first && data.messages.some((m) => m.id > latest && m.authorId !== me))
          sawNew.current = true;
        if (first && !after && (unreadAtOpen.current || unseen.current)) {
          unreadAtOpen.current = false;
          unseen.current = false;
          sawNew.current = true;
        }
        loaded.current = true;
        newestRef.current = Math.max(latest, ...data.messages.map((m) => m.id));
        return data.messages.length;
      };
      do {
        again.current = false;
        // Каждый шестой опрос (раз в полминуты) перечитывает последнюю страницу целиком:
        // правки, удаления и лайки чужих сообщений курсором afterId не приходят.
        polls.current += 1;
        const full = polls.current % 6 === 0 && !jumpedRef.current;
        // Новое догоняем страницами: за время разрыва его могло прийти больше страницы,
        // и одна страница с переносом курсора на её конец оставила бы дыру в истории.
        // После прыжка к найденному окно растёт к последним по странице за опрос.
        const pages = jumpedRef.current ? 1 : 20;
        let caughtUp = true;
        if (loaded.current && newestRef.current)
          for (let n = 0; (await page(newestRef.current)) >= MESSAGES_PAGE; n++)
            if (n + 1 >= pages) {
              caughtUp = false;
              break;
            }
        // Последнюю страницу целиком берём, только когда новое догнано: иначе между
        // догнанным и последней страницей осталась бы дыра. Не догнали: ещё проход.
        // Пустой диалог курсора не имеет: его последнюю страницу спрашиваем каждый раз,
        // иначе первое сообщение ждало бы полного перечитывания.
        if (!loaded.current || !newestRef.current || (full && caughtUp)) await page(0);
        if (sawNew.current && caughtUp) {
          sawNew.current = false;
          markSeen();
        }
        if (!caughtUp && !jumpedRef.current) again.current = true;
      } while (again.current);
    } catch {
      setError(t('Не удалось загрузить сообщения.'));
    } finally {
      loading.current = false;
    }
  }, [request, me, markSeen]);
  const realtime = useRealtime();
  usePolling(load, realtime ? MESSAGES_POLL_REALTIME_MS : MESSAGES_POLL_MS);

  // Снимок пишем только с данных портала и только у последних сообщений: окно после прыжка
  // к найденному не последняя страница.
  useEffect(() => {
    if (!loaded.current || jumped || !messages) return;
    rememberSnapshot(dialogId, {
      messages: messages.slice(-MESSAGES_PAGE),
      people,
      readers,
      canPost,
      role,
      hasOlder: hasOlder || messages.length > MESSAGES_PAGE,
    });
  }, [dialogId, messages, people, readers, canPost, role, hasOlder, jumped]);

  // Событие по этому диалогу: новое сообщение подтягивается сразу, а правка, удаление
  // и лайк перечитывают страницу целиком (курсор afterId такие изменения не отдаёт).
  // Правка или удаление сообщения со старой, уже подгруженной страницы: полное
  // перечитывание берёт только последнюю страницу, поэтому это сообщение спрашиваем само.
  // Две быстрые правки одного сообщения: применяется ответ только последнего запроса.
  const refreshing = useRef(new Map<number, number>());
  async function refreshOne(id: number) {
    const gen = generation.current;
    const mine = (refreshing.current.get(id) || 0) + 1;
    refreshing.current.set(id, mine);
    const data = await request(`&afterId=${id - 1}`).catch(() => null);
    if (!data || gen !== generation.current || refreshing.current.get(id) !== mine) return;
    const fresh = data.messages.find((m) => m.id === id);
    // Нет в ответе не значит удалено: портал мог отдать страницу новее него. Удалённое
    // портал и так оставляет на месте пометкой, её принесёт сам ответ.
    if (fresh) setMessages((current) => current && current.map((m) => (m.id === id ? fresh : m)));
  }

  useMessengerEvents((event) => {
    if (event.dialogId !== dialog.id) return;
    if (event.kind !== 'add') {
      polls.current = 5;
      const tailFrom = messages?.at(-MESSAGES_PAGE)?.id ?? 0;
      if (event.messageId && event.messageId < tailFrom) void refreshOne(event.messageId);
    }
    load();
  });

  const oldestId = messages?.[0]?.id;
  async function loadOlder() {
    if (!oldestId || loadingOlder) return;
    setLoadingOlder(true);
    const gen = generation.current;
    try {
      const data = await request(`&beforeId=${oldestId}`);
      if (gen !== generation.current) return;
      heightBeforePrepend.current = scroller.current?.scrollHeight || 0;
      // Старая страница только добавляет недостающее: версии, уже обновлённые опросом,
      // поздний ответ не откатывает.
      setMessages((current) => {
        const known = new Set((current || []).map((m) => m.id));
        return mergeMessages(
          current || [],
          data.messages.filter((m) => !known.has(m.id)),
        );
      });
      setPeople((known) => ({ ...known, ...data.people }));
      // Портал может вернуть больше LIMIT, но не меньше, пока история не кончилась.
      setHasOlder(data.messages.length >= MESSAGES_PAGE);
    } catch {
      setError(t('Не удалось загрузить более ранние сообщения.'));
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
    (message.authorId === me ? t('Я') : t('Пользователь {0}', message.authorId));

  // Заготовка задачи из реплики: название из первой строки, а в описание уходит вся
  // цитата и ссылка на сообщение, чтобы в Битриксе было видно, откуда задача.
  function taskDraft(message: Message) {
    // Построчно, чтобы абзацы реплики не слипались в одну строку.
    const lines = message.text
      .split('\n')
      .map((line) => bitrixPlainText(line, parseMessageNodes))
      .filter(Boolean);
    const plain = lines.join('\n');
    const title = (lines[0] || message.files[0]?.name || t('Задача из чата')).slice(0, 120);
    const link = portal
      ? `\nhttps://${portal}/online/?IM_DIALOG=${encodeURIComponent(dialog.id)}&IM_MESSAGE=${message.id}`
      : '';
    return {
      title,
      description: `${nameOf(message)}, ${new Date(message.date).toLocaleString(dateLocale())}:\n${plain}${link}`,
    };
  }

  const json = { 'Content-Type': 'application/json' };

  // Поле ввода открыто и во время отправки: если человек уже набирает следующее,
  // успешный ответ прошлой отправки не должен стереть новый текст.
  const clearSent = (sent: string) => {
    setDraft((current) => (current === sent ? '' : current));
    setMentions((current) => (draftRef.current === sent ? [] : current));
  };
  const draftRef = useRef('');
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  async function send() {
    // Ответ, выбранный при отправке: если за время запроса выбрали другой, его не трогаем.
    const replied = replyTo?.id;
    let unsure = false;
    const sent = draft;
    const raw = draft.trim();
    if ((!raw && !pending.length) || sending) return;
    beginSend();
    setError('');
    try {
      if (editing) {
        // Упоминание, выбранное в правке, тоже становится тегом; старые теги остаются.
        const edited = applyMentions(raw, mentions);
        const response = await fetch('/api/messenger/message', {
          method: 'PUT',
          headers: json,
          body: JSON.stringify({ messageId: editing.id, text: edited, dialogId }),
        }).catch(() => null);
        // Связь оборвалась: правка могла пройти. Перечитываем, а не объявляем отказ.
        if (!response || response.status >= 500) {
          unsure = true;
          throw new Error('UNSURE');
        }
        if (!response.ok) throw new Error(String(response.status));
        const id = editing.id;
        setMessages(
          (current) =>
            current && current.map((m) => (m.id === id ? { ...m, text: edited, edited: true } : m)),
        );
        // Пока шла правка, могли выбрать другое сообщение: тот выбор не сбрасываем.
        setEditing((current) => (current?.id === id ? null : current));
        // Правка ушла: в поле возвращается отложенный черновик нового сообщения.
        setDraft((current) => (current === sent ? beforeEdit.current : current));
        // Если за время запроса начали другую правку, её упоминания не трогаем.
        if (editingRef.current?.id === id) setMentions(beforeEditMentions.current);
        return;
      }
      const text =
        (replyTo ? quoteBlock(nameOf(replyTo), replyTo) : '') + applyMentions(raw, mentions);
      if (pending.length)
        await sendPending(text, sent, () => {
          clearSent(sent);
          setReplyTo((current) => (current?.id === replied ? null : current));
        });
      else {
        const response = await fetch('/api/messenger/messages', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ dialogId: dialog.id, text }),
        }).catch(() => null);
        // Нет ответа или портал не ответил (502): сообщение могло дойти. Перечитываем
        // историю и просим проверить её, а не повторять вслепую.
        if (!response || response.status >= 500) {
          unsure = true;
          throw new Error('UNSURE');
        }
        if (!response.ok) throw new Error(String(response.status));
      }
      clearSent(sent);
      // Переписку закрыли, пока шла отправка: сохранённый черновик с этим текстом тоже
      // чистим, иначе по возвращении его можно было бы отправить второй раз.
      if (closed.current) forgetSent(dialog.id, sent);
      setReplyTo((current) => (current?.id === replied ? null : current));
      stickToBottom.current = true;
      if (jumpedRef.current) showLatest();
      else load();
      onSent();
    } catch (failure) {
      // Черновик остаётся в поле: текст не теряется, можно отправить ещё раз.
      if ((failure as Error)?.message === 'UNSURE') unsure = true;
      if (unsure) load();
      // Правку старого сообщения полное перечитывание не покажет: спрашиваем его само.
      if (unsure && editing) void refreshOne(editing.id);
      const partial = /^PARTIAL:(\d+):(\d+)$/.exec((failure as Error)?.message || '');
      if (partial) {
        load();
        setError(
          t(
            'Отправлено файлов: {0} из {1}. Остальные остались в очереди, отправьте их ещё раз.',
            partial[1],
            partial[2],
          ),
        );
        return;
      }
      setError(
        editing && unsure
          ? t('Не удалось узнать, сохранилась ли правка. Проверьте сообщение в переписке.')
          : editing
            ? t(
                'Не удалось изменить сообщение: править можно только свои и недолго после отправки.',
              )
            : unsure
              ? t(
                  'Не удалось узнать, дошло ли сообщение. Проверьте переписку, прежде чем отправлять ещё раз.',
                )
              : t('Сообщение не отправилось. Попробуйте ещё раз.'),
      );
    } finally {
      finishSending(dialog.id);
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

  const restoreDraft = () => {
    setDraft(beforeEdit.current);
    setMentions(beforeEditMentions.current);
  };
  function startEdit(message: Message) {
    setReplyTo(null);
    if (!editing) {
      beforeEdit.current = draft;
      beforeEditMentions.current = mentions;
    }
    // У текста правки свой список упоминаний: чужие из черновика к нему не относятся.
    setMentions([]);
    setEditing(message);
    setDraft(message.text);
    inputRef.current?.focus();
  }

  function startReply(message: Message) {
    if (editing) restoreDraft();
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
    // Связь оборвалась: удаление могло пройти. Сверяем само сообщение с порталом.
    if (!response || response.status >= 500) {
      setError(t('Не удалось узнать, удалилось ли сообщение. Проверьте переписку.'));
      void refreshOne(target.id);
      return;
    }
    if (!response.ok) {
      setError(
        t('Не удалось удалить сообщение: удалять можно только свои и недолго после отправки.'),
      );
      return;
    }
    // Как в самом Битриксе: на месте сообщения остаётся пометка об удалении.
    setMessages(
      (current) =>
        current &&
        current.map((m) =>
          m.id === target.id
            ? { ...m, text: t('Это сообщение было удалено.'), files: [], attach: [], likes: [] }
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
    const text = // Цитата уходит коллегам в чат: она всегда русская, как и остальные
      // тексты, которые приложение пишет в Битрикс от вашего имени.
      quoteBlock(nameOf(message), message, 'Переслано от ', true);
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
    // Ответа нет или портал не ответил: пересылка могла дойти, повтор её задвоит.
    if (!response || response.status >= 500) {
      setError(
        t(
          'Не удалось узнать, дошла ли пересылка в «{0}». Проверьте этот чат, прежде чем повторять.',
          target.title,
        ),
      );
      return;
    }
    const result = response.ok ? await response.json().catch(() => null) : null;
    // 200 без разборчивого тела: исход неизвестен, «Переслано» говорить нельзя.
    if (response.ok && !result) {
      setError(
        t(
          'Не удалось узнать, дошла ли пересылка в «{0}». Проверьте этот чат, прежде чем повторять.',
          target.title,
        ),
      );
      return;
    }
    if (result && result.sent < result.total) {
      setError(
        t(
          'В «{0}» переслано файлов: {1} из {2}. Проверьте чат: остальные могли не дойти.',
          target.title,
          result.sent,
          result.total,
        ),
      );
      onSent();
    } else if (result) {
      setNotice(t('Переслано в «{0}»', target.title));
      onSent();
    } else setError(t('Не удалось переслать сообщение.'));
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
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => setMembers(data.users))
        // Состав не загрузился: следующий @ спросит снова, а пока видно, почему пусто.
        .catch(() => {
          setMembers(null);
          setError(t('Не удалось загрузить участников чата для упоминания.'));
        });
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
    // Найденное по прошлому запросу не должно вести к сообщению под новым.
    setResults(null);
    if (!searchOpen || needle.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(
        `/api/messenger/search?dialogId=${encodeURIComponent(dialog.id)}&q=${encodeURIComponent(needle)}`,
        { signal: controller.signal },
      )
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => {
          setSearchFailed(false);
          setResults([...data.messages].reverse());
          setPeople((known) => ({ ...known, ...data.people }));
        })
        // Сбой поиска не выдаём за «Ничего не найдено»; смена запроса отменяет прошлый.
        .catch((error) => {
          if (error?.name === 'AbortError') return;
          setResults([]);
          setSearchFailed(true);
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, searchOpen, dialog.id]);

  // Переход к найденному: берём страницу истории, оканчивающуюся этим сообщением.
  async function jumpTo(id: number) {
    try {
      const gen = ++generation.current;
      const data = await request(`&beforeId=${id + 1}`);
      if (gen !== generation.current) return;
      // Сообщение успели удалить: пустое окно сломало бы курсор, остаёмся где были.
      if (!data.messages.some((m) => m.id === id)) {
        setError(t('Это сообщение больше недоступно.'));
        return;
      }
      // Опрос, начатый во время запроса, уже взял это поколение: новое окно его не примет.
      generation.current += 1;
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
      setError(t('Не удалось открыть найденное сообщение.'));
    }
  }

  function showLatest() {
    generation.current += 1;
    jumpedRef.current = false;
    setJumped(false);
    setMessages(null);
    newestRef.current = 0;
    loaded.current = false;
    // Отложенная отметка прочитанного сработает после загрузки последних сообщений.
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
  // unsure: ответа нет или портал не ответил (502), файл мог дойти. Такой исход не
  // предлагаем повторить вслепую: повтор дал бы второй файл и вторую подпись.
  function postFile(file: File, caption: string): Promise<'ok' | 'fail' | 'unsure'> {
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
      request.onload = () =>
        resolve(
          request.status >= 200 && request.status < 300
            ? 'ok'
            : request.status >= 500
              ? 'unsure'
              : 'fail',
        );
      request.onerror = () => resolve('unsure');
      setProgress(0);
      request.send(body);
    });
  }

  function addFiles(files: File[]) {
    const tooBig = files.find((file) => file.size > MAX_FILE_SIZE);
    if (tooBig) setError(t('Файл «{0}» больше {1}.', tooBig.name, formatBytes(MAX_FILE_SIZE)));
    const fits = files.filter((file) => file.size <= MAX_FILE_SIZE);
    if (fits.length) setPending((current) => [...current, ...fits]);
  }

  // Голосовое уходит сразу: проверять в нём нечего.
  // Блокировку отправки голосовое занимает раньше, при остановке записи.
  async function upload(file: File) {
    setError('');
    try {
      const result = await postFile(file, '');
      // Запись не теряется: при сбое она возвращается в очередь, откуда её можно
      // отправить ещё раз или убрать, если она всё-таки дошла.
      if (result !== 'ok') {
        setPending((current) => [...current, file]);
        // Переписку уже закрыли: запись кладём в очередь её диалога напрямую.
        if (closed.current) {
          const saved = drafts.get(dialog.id) ?? { text: '', files: [] };
          drafts.set(dialog.id, { ...saved, files: [...saved.files, file] });
          // Переписку уже открыли заново: её копия тоже покажет запись в очереди.
          for (const listener of sentListeners) listener({ dialogId: dialog.id, requeued: file });
        }
      }
      if (result === 'unsure') {
        load();
        setError(
          t(
            'Не удалось узнать, дошло ли «{0}». Проверьте переписку, прежде чем отправлять ещё раз.',
            file.name,
          ),
        );
        return;
      }
      if (result === 'fail') throw new Error('upload');
      stickToBottom.current = true;
      load();
      onSent();
    } catch {
      setError(t('Не удалось отправить «{0}». Попробуйте ещё раз.', file.name));
    } finally {
      setProgress(null);
      finishSending(dialog.id);
    }
  }

  // Подпись уходит с первым файлом, как в самом Битриксе. Отправленные файлы
  // покидают очередь сразу: при сбое остаются только неотправленные.
  // Подпись уходит с первым файлом. Если следующий файл не загрузился, подпись уже у
  // получателя: поле и цитату очищаем сразу, иначе повтор отправил бы её второй раз.
  async function sendPending(caption: string, sentText: string, captionSent: () => void) {
    let first = true;
    let done = 0;
    for (const file of pending) {
      const result = await postFile(file, first ? caption : '');
      if (result !== 'ok') {
        setProgress(null);
        if (result === 'unsure') throw new Error('UNSURE');
        // Часть уже у получателя: это не «не отправилось», а «осталось в очереди».
        throw new Error(done ? `PARTIAL:${done}:${pending.length}` : file.name);
      }
      done += 1;
      if (closed.current) forgetFile(dialog.id, file);
      if (first && caption) {
        captionSent();
        if (closed.current) forgetSent(dialog.id, sentText);
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
  const closed = useRef(false);
  useEffect(() => {
    // StrictMode монтирует эффект дважды: флаг поднимается заново после пробной очистки.
    closed.current = false;
    return () => {
      closed.current = true;
      const recorder = recorderRef.current;
      if (!recorder) return;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Пока браузер спрашивает разрешение, повторное нажатие не запускает вторую запись:
  // её поток никто бы не остановил.
  const starting = useRef(false);
  async function startRecording() {
    if (starting.current || recorderRef.current) return;
    starting.current = true;
    setError('');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Разрешение выдали, когда диалог уже закрыт или писать в него стало нельзя: иначе
      // микрофон остался бы включён без кнопки остановки.
      if (closed.current || !canPostRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      // Firefox пишет ogg, Safari mp4, Chrome только webm: берём лучшее из поддерживаемого.
      const mimeType = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const parts: Blob[] = [];
      chunks.current.set(recorder, parts);
      recorder.ondataavailable = (event) => {
        if (event.data.size) parts.push(event.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      setError(t('Нет доступа к микрофону. Разрешите его в настройках браузера.'));
    } finally {
      starting.current = false;
    }
  }

  // Право писать пропало посреди записи: кнопок остановки больше нет, поэтому запись
  // отменяем сами и отпускаем микрофон.
  useEffect(() => {
    if (!canPost && recorderRef.current) finishRecording(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPost]);

  function finishRecording(send: boolean) {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    // Отправку занимаем сразу: onstop придёт позже, и текст, отправленный в этот
    // промежуток, иначе ушёл бы параллельно голосовому.
    if (send) beginSend();
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((track) => track.stop());
      const type = recorder.mimeType || 'audio/webm';
      const parts = chunks.current.get(recorder) || [];
      if (send && parts.length) {
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
        const file = new File(parts, `${VOICE_NAME} ${stamp}.${ext}`, { type });
        // Переписку закрыли, пока запись останавливалась: отправка уже ушла бы в фоне без
        // видимого результата, поэтому кладём запись в очередь её диалога.
        if (closed.current) {
          const saved = drafts.get(dialog.id) ?? { text: '', files: [] };
          drafts.set(dialog.id, { ...saved, files: [...saved.files, file] });
          for (const listener of sentListeners) listener({ dialogId: dialog.id, requeued: file });
          finishSending(dialog.id);
        } else void upload(file);
      } else if (send) finishSending(dialog.id);
      chunks.current.delete(recorder);
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
          {t('Отпустите файлы, чтобы прикрепить')}
        </div>
      )}
      <div className="flex min-h-14 items-center gap-3 border-b border-line px-3">
        <Button
          variant="quiet"
          size="sm"
          className="md:hidden"
          onClick={onBack}
          aria-label={t('К списку диалогов')}
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
            {dialog.kind === 'task' ? t('Открыть задачу') : t('Открыть проект')}
          </Link>
        )}
        {portal && (
          // Звонки и видеоконференции REST создавать не умеет: они живут в самом Битриксе.
          <a
            href={`https://${portal}/online/?IM_DIALOG=${encodeURIComponent(dialog.id)}`}
            target="_blank"
            rel="noreferrer"
            aria-label={t('Открыть диалог в Битриксе (там есть звонки)')}
            title={t('Открыть в Битриксе: там есть звонки и видеоконференции')}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-ui text-ink-soft transition-colors duration-fast hover:bg-surface hover:text-ink max-sm:size-11"
          >
            <Video className="size-4" strokeWidth={1.7} />
          </a>
        )}
        {dialog.kind === 'chat' && /^chat\d+$/.test(dialog.id) && (
          <IconButton
            label={t('Настройки чата')}
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
          >
            <Users className="size-4" strokeWidth={1.7} />
          </IconButton>
        )}
        <IconButton
          label={dialog.pinned ? t('Открепить диалог') : t('Закрепить диалог')}
          variant="ghost"
          pressed={Boolean(dialog.pinned)}
          onClick={onPin}
        >
          <Pin className={`size-4 ${dialog.pinned ? 'fill-current' : ''}`} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          label={t('Поиск по сообщениям')}
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
            label={t('Поиск по сообщениям')}
            placeholder={t('Поиск по сообщениям (от двух букв)')}
            size="sm"
            value={searchQuery}
            onChange={setSearchQuery}
          />
          {results !== null && (
            <ul className="max-h-56 overflow-y-auto" aria-label={t('Найденные сообщения')}>
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
                      {bitrixPlainText(message.text, parseMessageNodes) || t('Вложение')}
                    </span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="p-2 text-xs text-ink-soft">
                  {searchFailed
                    ? t('Поиск не выполнился. Измените запрос, чтобы попробовать ещё раз.')
                    : t('Ничего не найдено')}
                </li>
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
          flushSeen();
        }}
      >
        {jumped && (
          <div className="sticky top-0 z-10 flex justify-center">
            <Button variant="secondary" size="sm" onClick={showLatest}>
              {t('К последним сообщениям')}
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
              {loadingOlder ? t('Загрузка') : t('Показать более ранние')}
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
                  // Сообщение получает фокус с клавиатуры: панель действий открывается по
                  // фокусу (group-focus-within), а Enter или пробел держат её открытой.
                  tabIndex={0}
                  role="group"
                  aria-label={t(
                    'Сообщение {0}, {1}',
                    message.authorId === me ? 'от вас' : `от ${nameOf(message)}`,
                    when(message.date),
                  )}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActionsFor((current) => (current === message.id ? null : message.id));
                    }
                  }}
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
                        label={t('Ответить')}
                        variant="ghost"
                        size="sm"
                        className="max-sm:h-9 max-sm:w-9"
                        onClick={() => startReply(message)}
                      >
                        <CornerUpLeft className="size-3.5" strokeWidth={1.7} />
                      </IconButton>
                      <IconButton
                        label={liked ? t('Убрать лайк') : t('Нравится')}
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
                        label={t('Создать задачу')}
                        variant="ghost"
                        size="sm"
                        className="max-sm:h-9 max-sm:w-9"
                        onClick={() => setTaskFrom(message)}
                      >
                        <ListPlus className="size-3.5" strokeWidth={1.7} />
                      </IconButton>
                      <IconButton
                        label={t('Переслать')}
                        variant="ghost"
                        size="sm"
                        className="max-sm:h-9 max-sm:w-9"
                        onClick={() => setForwarding(message)}
                      >
                        <Forward className="size-3.5" strokeWidth={1.7} />
                      </IconButton>
                      {mine && message.text && (
                        <IconButton
                          label={t('Изменить')}
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
                          label={t('Удалить')}
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
                      {people[String(message.authorId)]?.name ||
                        t('Пользователь {0}', message.authorId)}
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
                    <p className="text-sm text-ink-soft">{t('Сообщение без текста')}</p>
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
                        aria-label={t('Нравится: {0}', message.likes.length)}
                        className="mr-auto inline-flex items-center gap-1 rounded-ui border border-line px-1.5 py-0.5"
                      >
                        <Heart
                          className={`size-3 ${liked ? 'fill-current text-accent-text' : ''}`}
                          strokeWidth={1.7}
                        />
                        {message.likes.length}
                      </button>
                    )}
                    {message.edited && <span>{t('изменено')}</span>}
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
          {t('В этом канале писать могут только администраторы')}
        </p>
      ) : recording ? (
        <div className="flex items-center gap-3 border-t border-line p-3">
          <Mic className="size-4 animate-pulse text-danger-text" strokeWidth={1.7} />
          <span className="flex-1 text-sm text-ink" role="timer">
            {t('Запись')} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </span>
          <Button
            variant="quiet"
            onClick={() => finishRecording(false)}
            aria-label={t('Отменить запись')}
          >
            <X className="size-4" strokeWidth={1.7} />
          </Button>
          <Button onClick={() => finishRecording(true)} aria-label={t('Отправить голосовое')}>
            <Send className="size-4" strokeWidth={1.7} />
          </Button>
        </div>
      ) : (
        <div className="relative border-t border-line">
          {(replyTo || editing) && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-soft">
              <span className="min-w-0 flex-1 truncate">
                {editing
                  ? t('Редактирование сообщения')
                  : t(
                      'Ответ для {0}: {1}',
                      nameOf(replyTo!),
                      bitrixPlainText(replyTo!.text, parseMessageNodes) || 'вложение',
                    )}
              </span>
              <IconButton
                label={t('Отменить')}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReplyTo(null);
                  setEditing(null);
                  if (editing) restoreDraft();
                }}
              >
                <X className="size-3.5" strokeWidth={1.7} />
              </IconButton>
            </div>
          )}
          {pending.length > 0 && (
            <ul
              className="flex flex-wrap gap-2 border-b border-line px-3 py-2"
              aria-label={t('Прикреплённые файлы')}
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
              aria-label={t('Отправка файла')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1 bg-surface-2"
            >
              <div
                className="h-full bg-ink transition-[width] duration-base"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {mention && suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label={t('Упомянуть')}
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
              aria-label={t('Файлы')}
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
              aria-label={t('Прикрепить файл')}
            >
              <Paperclip className="size-4" strokeWidth={1.7} />
            </Button>
            <TextArea
              aria-label={t('Сообщение')}
              placeholder={t('Сообщение')}
              variant="boxed"
              rows={1}
              // textarea по умолчанию строчный: под ним остаётся зазор в 7 px, обёртка выше
              // поля, и поле висит над кнопками. block убирает зазор, а высота в одну строку
              // равна кнопкам (min-h-9, на телефоне min-h-11).
              className="flex-1 [&_textarea]:block [&_textarea]:max-h-60 [&_textarea]:min-h-9 [&_textarea]:resize-none [&_textarea]:py-1.5 max-sm:[&_textarea]:min-h-11"
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
                  if (editing) restoreDraft();
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
                aria-label={t('Записать голосовое')}
              >
                <Mic className="size-4" strokeWidth={1.7} />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={(!draft.trim() && !pending.length) || sending}
                aria-label={t('Отправить')}
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
        title={t('Удалить сообщение?')}
        description={t('Сообщение удалится у всех участников чата.')}
        confirmLabel={t('Удалить')}
      />
      {taskFrom && (
        <QuickCreateTask initial={taskDraft(taskFrom)} onClose={() => setTaskFrom(null)} />
      )}
      <ChatSettingsModal
        open={settingsOpen}
        dialog={dialog}
        me={me}
        onClose={() => setSettingsOpen(false)}
        onRenamed={(title) => {
          setSettingsOpen(false);
          onRenamed(title);
        }}
        onTitleSync={onRenamed}
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
        aria-label={t('Убрать {0}', file.name)}
        className="shrink-0 text-ink-soft hover:text-ink disabled:opacity-30"
      >
        <X className="size-3.5" strokeWidth={1.7} />
      </button>
    </li>
  );
}

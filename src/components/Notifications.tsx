'use client';

import { Bell, CheckCircle2, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import BitrixText from '@/components/BitrixText';
import { IconButton } from '@/components/monos/IconButton';
import { Popover } from '@/components/monos/Popover';
import { Separator } from '@/components/monos/Separator';
import Link from 'next/link';
import { useSSE } from '@/hooks/useSSE';
import { useKanbanStore } from '@/store/kanban';
import { t, dateFormat, relativeFormat } from '@/lib/i18n';

type Notice = {
  id: string;
  type: string;
  title: string;
  message: string;
  taskId?: string;
  projectId?: string;
  created_at?: string;
  createdAt?: string;
};

function icon(type: string) {
  if (type === 'comment_added')
    return <MessageSquareText className="size-4 text-info-text" strokeWidth={1.7} />;
  if (type === 'task_added')
    return <CheckCircle2 className="size-4 text-success-text" strokeWidth={1.7} />;
  if (type === 'task_deleted')
    return <Trash2 className="size-4 text-danger-text" strokeWidth={1.7} />;
  return <Pencil className="size-4 text-warning-text" strokeWidth={1.7} />;
}

// Список задач меняют только события о самой задаче. Комментарий задачу не
// меняет, а перезагрузка списка стирала бы комментарии в открытой карточке:
// они лежат в чате Bitrix, в списке их нет.
const TASK_LIST_EVENTS = new Set(['task_added', 'task_updated', 'task_deleted', 'tasks-changed']);

const TIMESTAMP = dateFormat({ dateStyle: 'medium', timeStyle: 'short' });
const RELATIVE = relativeFormat({ numeric: 'auto' });

// Свежие события показываем относительно («5 минут назад»), для старости
// больше недели точность не нужна — возвращаем полную дату.
function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  const diff = Math.round((time - Date.now()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return RELATIVE.format(diff, 'second');
  if (abs < 3600) return RELATIVE.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return RELATIVE.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return RELATIVE.format(Math.round(diff / 86400), 'day');
  return TIMESTAMP.format(new Date(time));
}

export default function Notifications({
  placement = 'bottom',
  align,
  className,
}: {
  placement?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'end';
  className?: string;
} = {}) {
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const selectedProjectId = useKanbanStore((state) => state.selectedProjectId);
  const loadTasks = useKanbanStore((state) => state.loadTasks);
  const memberId = useKanbanStore((state) => state.memberId);

  const [historyFailed, setHistoryFailed] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!memberId) return;
    try {
      const response = await fetch(`/api/notifications?member_id=${encodeURIComponent(memberId)}`, {
        headers: { 'X-Member-Id': memberId },
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setItems(data.notifications || []);
      setHistoryFailed(false);
    } catch {
      // Поповер скажет о сбое вместо «изменений нет», а при открытии окно
      // отметит прочитанным только после загрузки.
      setHistoryFailed(true);
    }
  }, [memberId]);

  useEffect(() => {
    if (!memberId) return;
    const saved = Number(localStorage.getItem(`bitrix-notifications-seen:${memberId}`));
    setSeenAt(Number.isFinite(saved) && saved > 0 ? saved : Date.now());
  }, [memberId]);

  // История нужна сразу после монтирования: до первого открытия окна бейдж
  // непрочитанных считается по пустому списку, и колокольчик молчит.
  useEffect(() => {
    if (!memberId) return;
    void loadHistory();
  }, [loadHistory, memberId]);

  useEffect(() => {
    if (!open || !memberId) return;
    void loadHistory();
  }, [loadHistory, memberId, open]);

  const markAsSeen = useCallback(() => {
    if (!memberId) return;
    const timestamp = Date.now();
    localStorage.setItem(`bitrix-notifications-seen:${memberId}`, String(timestamp));
    setSeenAt(timestamp);
  }, [memberId]);

  const unreadCount = items.filter((item) => {
    const timestamp = new Date(item.createdAt || item.created_at || 0).getTime();
    return Number.isFinite(timestamp) && timestamp > seenAt;
  }).length;

  const onEvent = useCallback(
    (event: Notice) => {
      // Служебные сигналы синка (tasks-changed из events_stream) приходят без
      // title/message: в ленте им не место, но перечитывать список задач нужно.
      const isNotice = typeof event.title === 'string' && typeof event.message === 'string';
      if (isNotice) {
        setItems((current) => {
          if (event.id) {
            const incomingId = String(event.id);
            if (current.some((item) => String(item.id) === incomingId)) return current;
          }
          return [
            { ...event, id: event.id || `${event.createdAt || Date.now()}-${event.type}` },
            ...current,
            // Потолок держит память и DOM колокольчика: как страница уведомлений.
          ].slice(0, 200);
        });
      }
      if (selectedProjectId && TASK_LIST_EVENTS.has(String(event.type))) {
        void loadTasks(selectedProjectId, true);
      }
    },
    [loadTasks, selectedProjectId],
  );

  useSSE(memberId, onEvent);

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        // Отмечаем прочитанным только после того, как история реально загрузилась:
        // иначе при сбое сети бейдж обнуляется, а список показывает старое.
        if (value) void loadHistory().then(markAsSeen);
      }}
      placement={placement}
      align={align}
      className={className}
      // Панель по умолчанию в 288 px с полями: список шириной 320 внутри неё обрезался справа.
      panelClassName="w-80 max-h-none overflow-y-visible p-0"
      trigger={
        <IconButton label={t('Уведомления')} variant="ghost" size="sm" className="relative">
          <Bell size={16} strokeWidth={1.7} />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-canvas">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </IconButton>
      }
    >
      <div>
        <p className="px-3 py-2.5 text-xs uppercase tracking-widest text-ink-faint">
          {t('История изменений')}
        </p>
        <Separator />
        <div className="max-h-[min(24rem,calc(100dvh-14rem))] overflow-y-auto p-1">
          {items.length ? (
            items.map((item) => {
              // Проект в событии есть не всегда (883 записи из 3870 без него),
              // а задача есть почти везде: без проекта открываем её в общем
              // списке, иначе уведомление просто не кликалось.
              const href = item.taskId
                ? item.projectId && item.projectId !== '0'
                  ? `/projects/${item.projectId}?task=${encodeURIComponent(item.taskId)}`
                  : `/all-tasks?task=${encodeURIComponent(item.taskId)}`
                : null;
              const createdAt = item.created_at || item.createdAt;
              const timestamp = new Date(createdAt || 0).getTime();
              const unread = Number.isFinite(timestamp) && timestamp > seenAt;
              const row = (
                <>
                  <span className="mt-0.5">{icon(item.type)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-bold text-ink">
                      {unread && (
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-info" />
                      )}
                      <span className="min-w-0 truncate">{item.title}</span>
                    </p>
                    <p className="line-clamp-2 text-xs text-ink-soft">
                      <BitrixText text={item.message} />
                    </p>
                    {createdAt && (
                      <time
                        dateTime={createdAt}
                        className="mt-0.5 block text-[11px] text-ink-faint"
                      >
                        {relativeTime(createdAt)}
                      </time>
                    )}
                  </div>
                </>
              );
              return href ? (
                <Link
                  prefetch={false}
                  key={item.id}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`flex gap-2 rounded-ui px-2 py-2.5 text-sm transition-colors duration-fast hover:bg-surface ${unread ? 'bg-surface' : ''}`}
                >
                  {row}
                </Link>
              ) : (
                <div
                  key={item.id}
                  className={`flex gap-2 rounded-ui px-2 py-2.5 text-sm ${unread ? 'bg-surface' : ''}`}
                >
                  {row}
                </div>
              );
            })
          ) : (
            <p className="px-3 py-8 text-center text-xs text-ink-faint">
              {historyFailed ? t('Не удалось загрузить уведомления') : t('Изменений пока нет')}
            </p>
          )}
        </div>
        <Separator />
        <Link
          prefetch={false}
          href="/notifications"
          onClick={() => setOpen(false)}
          className="block px-3 py-2.5 text-center text-xs font-bold uppercase tracking-widest text-ink transition-opacity duration-fast hover:opacity-60"
        >
          {t('Открыть все уведомления')}
        </Link>
      </div>
    </Popover>
  );
}

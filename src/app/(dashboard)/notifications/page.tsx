'use client';

import Link from 'next/link';
import { CheckCircle2, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';
import BitrixText from '@/components/BitrixText';
import PageHeader from '@/components/PageHeader';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useKanbanStore } from '@/store/kanban';

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

function noticeIcon(type: string) {
  if (type === 'comment_added') return <MessageSquareText className="size-4 text-sky-600" />;
  if (type === 'task_added') return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (type === 'task_deleted') return <Trash2 className="size-4 text-destructive" />;
  return <Pencil className="size-4 text-amber-600" />;
}

function noticeLabel(type: string) {
  if (type === 'comment_added') return 'Комментарий';
  if (type === 'task_added') return 'Новая задача';
  if (type === 'task_deleted') return 'Удаление задачи';
  return 'Изменение задачи';
}

const PAGE_SIZE = 50;

async function fetchPage(
  before: string | null,
  signal?: AbortSignal,
): Promise<{ notifications: Notice[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before) params.set('before', before);
  const response = await fetch(`/api/notifications?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return { notifications: data.notifications || [], nextCursor: data.nextCursor || null };
}

export default function NotificationsPage() {
  const confirm = useConfirm();
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  // Лента кусками по 50, как колонки доски: раньше грузились сразу 200 записей
  // и ~3800 DOM-узлов, хотя смотрят обычно верхние.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Без этого сбой загрузки выглядел как «Пока нет уведомлений».
  const [error, setError] = useState('');
  const projectNames = useKanbanStore((state) => state.projects);
  const projectName = (id: string) => projectNames.find((project) => project.id === id)?.name;

  useEffect(() => {
    const controller = new AbortController();
    void fetchPage(null, controller.signal)
      .then((data) => {
        setItems(data.notifications);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Не удалось загрузить уведомления. Обновите страницу.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const data = await fetchPage(nextCursor);
      setItems((current) => [...current, ...data.notifications]);
      setNextCursor(data.nextCursor);
    } catch {
      setError('Не удалось загрузить ещё. Попробуйте снова.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function clearHistory() {
    if (!items.length) return;
    const agreed = await confirm({
      title: 'Очистить историю уведомлений?',
      description: 'Записи удалятся безвозвратно, сами задачи в Битриксе не изменятся.',
      confirmLabel: 'Очистить',
      destructive: true,
    });
    if (!agreed) return;
    setClearing(true);
    try {
      const response = await fetch('/api/notifications', { method: 'DELETE' });
      if (response.ok) {
        setItems([]);
        setNextCursor(null);
      } else setError('Не удалось очистить историю. Попробуйте ещё раз.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Уведомления"
        description="Последние изменения в задачах Битрикс24"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void clearHistory()}
            disabled={!items.length || clearing}
          >
            Очистить
          </Button>
        }
      />
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {loading ? (
          <LoadingState className="min-h-72 bg-transparent" />
        ) : items.length ? (
          <div className="space-y-2">
            {items.map((item) => {
              // Проект в событии есть не всегда (883 записи из 3870 без него),
              // а задача есть почти везде: без проекта открываем её в общем
              // списке, иначе уведомление просто не кликалось.
              const href = item.taskId
                ? item.projectId && item.projectId !== '0'
                  ? `/projects/${item.projectId}?task=${encodeURIComponent(item.taskId)}`
                  : `/all-tasks?task=${encodeURIComponent(item.taskId)}`
                : null;
              const createdAt = item.created_at || item.createdAt;
              const typeLabel = noticeLabel(item.type);
              const titleIncludesType = item.title
                .toLocaleLowerCase('ru')
                .startsWith(typeLabel.toLocaleLowerCase('ru'));
              const content = (
                <Card className={`py-0 ${href ? 'transition-colors hover:bg-muted/50' : ''}`}>
                  <CardContent className="flex gap-3 p-4">
                    <span className="mt-0.5">{noticeIcon(item.type)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-medium">{item.title}</p>
                        {!titleIncludesType && (
                          <span className="text-xs text-muted-foreground">{typeLabel}</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        <BitrixText text={item.message} />
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {item.taskId && <span>Задача #{item.taskId}</span>}
                        {/* Номер проекта ничего не говорит: показываем название, а пока
                            список проектов не пришёл — молчим. */}
                        {item.projectId && projectName(item.projectId) && (
                          <span>{projectName(item.projectId)}</span>
                        )}
                        {createdAt && (
                          <time dateTime={createdAt}>
                            {new Intl.DateTimeFormat('ru-RU', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }).format(new Date(createdAt))}
                          </time>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              return href ? (
                <Link key={item.id} href={href} className="block">
                  {content}
                </Link>
              ) : (
                <div key={item.id}>{content}</div>
              );
            })}
            {nextCursor && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? 'Загружаем…' : 'Показать ещё'}
              </Button>
            )}
          </div>
        ) : error ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Пока нет уведомлений</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Изменения задач и комментарии из Битрикс24 появятся здесь.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

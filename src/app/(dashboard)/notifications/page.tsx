'use client';

import Link from 'next/link';
import { CheckCircle2, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';
import BitrixText from '@/components/BitrixText';
import PageHeader from '@/components/PageHeader';
import { toolbarSelect } from '@/components/ui/toolbar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const NOTICE_DATE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const PAGE_SIZE = 50;

const TYPE_OPTIONS = [
  { value: 'all', label: 'Все события' },
  { value: 'comment_added', label: 'Комментарии' },
  { value: 'task_updated', label: 'Изменения задач' },
  { value: 'task_added', label: 'Новые задачи' },
  { value: 'task_deleted', label: 'Удаления' },
];

async function fetchPage(
  page: number,
  filters: { projectId: string; type: string },
  signal?: AbortSignal,
): Promise<{ notifications: Notice[]; total: number }> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
  if (filters.projectId !== 'all') params.set('projectId', filters.projectId);
  if (filters.type !== 'all') params.set('type', filters.type);
  const response = await fetch(`/api/notifications?${params}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return { notifications: data.notifications || [], total: Number(data.total) || 0 };
}

// Те же номера, что в пейджере задач: первая, соседние, последняя.
function pageNumbers(page: number, pageCount: number) {
  return [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((left, right) => left - right);
}

export default function NotificationsPage() {
  const confirm = useConfirm();
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  // Постранично по 50, как списки задач: раньше грузились сразу 200 записей
  // и ~3800 DOM-узлов, хотя смотрят обычно верхние.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [projectFilter, setProjectFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const requestKey = `${page}|${projectFilter}|${typeFilter}`;
  const [loadedKey, setLoadedKey] = useState('');
  const pageLoading = loadedKey !== requestKey;
  const goToPage = (next: number) => {
    setError('');
    setPage(next);
  };
  const changeFilter = (apply: () => void) => {
    setError('');
    apply();
    setPage(1);
  };
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Без этого сбой загрузки выглядел как «Пока нет уведомлений».
  const [error, setError] = useState('');
  const projectNames = useKanbanStore((state) => state.projects);
  const projectName = (id: string) => projectNames.find((project) => project.id === id)?.name;

  useEffect(() => {
    const controller = new AbortController();
    void fetchPage(page, { projectId: projectFilter, type: typeFilter }, controller.signal)
      .then((data) => {
        setItems(data.notifications);
        setTotal(data.total);
        window.scrollTo({ top: 0 });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Не удалось загрузить уведомления. Обновите страницу.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadedKey(`${page}|${projectFilter}|${typeFilter}`);
        }
      });
    return () => controller.abort();
  }, [page, projectFilter, typeFilter]);

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
        setTotal(0);
        goToPage(1);
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
        {/* Лента за все проекты длинная: фильтр по проекту и типу события. */}
        <div className="mb-3 flex flex-wrap gap-2">
          <Select
            value={projectFilter}
            onValueChange={(value) => changeFilter(() => setProjectFilter(value))}
          >
            <SelectTrigger className={`${toolbarSelect} w-56`} aria-label="Проект">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все проекты</SelectItem>
              {projectNames
                .filter((project) => !project.isArchived)
                .map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select
            value={typeFilter}
            onValueChange={(value) => changeFilter(() => setTypeFilter(value))}
          >
            <SelectTrigger className={`${toolbarSelect} w-44`} aria-label="Тип события">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
                            {NOTICE_DATE.format(new Date(createdAt))}
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
            {pageCount > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} из {total},
                  страница {page} из {pageCount}
                </p>
                <div
                  className="flex flex-wrap items-center justify-end gap-1"
                  aria-label="Пагинация"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="hidden sm:inline-flex"
                    onClick={() => goToPage(1)}
                    disabled={pageLoading || page === 1}
                  >
                    Первая
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(page - 1)}
                    disabled={pageLoading || page === 1}
                  >
                    Назад
                  </Button>
                  {pageNumbers(page, pageCount).map((number) => (
                    <Button
                      key={number}
                      variant={number === page ? 'default' : 'outline'}
                      size="sm"
                      className="w-9 px-0"
                      onClick={() => goToPage(number)}
                      disabled={pageLoading}
                    >
                      {number}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(page + 1)}
                    disabled={pageLoading || page >= pageCount}
                  >
                    Вперёд
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="hidden sm:inline-flex"
                    onClick={() => goToPage(pageCount)}
                    disabled={pageLoading || page >= pageCount}
                  >
                    Последняя
                  </Button>
                </div>
              </div>
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

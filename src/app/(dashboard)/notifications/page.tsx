'use client';

import Link from 'next/link';
import { CheckCircle2, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/monos/Card';
import { Button } from '@/components/monos/Button';
import LoadingState from '@/components/LoadingState';
import BitrixText from '@/components/BitrixText';
import PageHeader from '@/components/PageHeader';
import { toolbarSelect } from '@/components/monos/toolbar';
import { SelectField } from '@/components/monos/SelectField';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { useKanbanStore } from '@/store/kanban';
import { dateFormat, numberFormat, t } from '@/lib/i18n';

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
  if (type === 'comment_added')
    return <MessageSquareText className="size-4 text-info-text" strokeWidth={1.7} />;
  if (type === 'task_added')
    return <CheckCircle2 className="size-4 text-success-text" strokeWidth={1.7} />;
  if (type === 'task_deleted')
    return <Trash2 className="size-4 text-danger-text" strokeWidth={1.7} />;
  return <Pencil className="size-4 text-warning-text" strokeWidth={1.7} />;
}

function noticeLabel(type: string) {
  if (type === 'comment_added') return t('Комментарий');
  if (type === 'task_added') return t('Новая задача');
  if (type === 'task_deleted') return t('Удаление задачи');
  return t('Изменение задачи');
}

const NOTICE_DATE = dateFormat({ dateStyle: 'medium', timeStyle: 'short' });
const PAGE_SIZE = 50;

const TYPE_OPTIONS = [
  {
    value: 'all',
    get label() {
      return t('Все события');
    },
  },
  {
    value: 'comment_added',
    get label() {
      return t('Комментарии');
    },
  },
  {
    value: 'task_updated',
    get label() {
      return t('Изменения задач');
    },
  },
  {
    value: 'task_added',
    get label() {
      return t('Новые задачи');
    },
  },
  {
    value: 'task_deleted',
    get label() {
      return t('Удаления');
    },
  },
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
          setError(t('Не удалось загрузить уведомления. Обновите страницу.'));
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
      title: t('Очистить историю уведомлений?'),
      description: t('Записи удалятся безвозвратно, сами задачи в Битриксе не изменятся.'),
      confirmLabel: t('Очистить'),
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
      } else setError(t('Не удалось очистить историю. Попробуйте ещё раз.'));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <PageHeader
        title={t('Уведомления')}
        description={t('Последние изменения в задачах Битрикс24')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void clearHistory()}
            disabled={!items.length || clearing}
          >
            {t('Очистить')}
          </Button>
        }
      />
      <div className="mx-auto max-w-4xl p-4 lg:p-6">
        {/* Лента за все проекты длинная: фильтр по проекту и типу события. */}
        <div className="mb-3 flex flex-wrap gap-2">
          <SelectField
            size="sm"
            variant="boxed"
            className={`${toolbarSelect} w-56`}
            aria-label={t('Проект')}
            value={projectFilter}
            onChange={(event) => changeFilter(() => setProjectFilter(event.target.value))}
            options={[
              { value: 'all', label: t('Все проекты') },
              ...projectNames
                .filter((project) => !project.isArchived)
                .map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
          <SelectField
            size="sm"
            variant="boxed"
            className={`${toolbarSelect} w-44`}
            aria-label={t('Тип события')}
            value={typeFilter}
            onChange={(event) => changeFilter(() => setTypeFilter(event.target.value))}
            options={TYPE_OPTIONS}
          />
        </div>
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger-text">
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
                <Card
                  padding="none"
                  className={href ? 'transition-colors duration-fast hover:bg-surface-2' : ''}
                >
                  <div className="flex gap-3 p-4">
                    <span className="mt-0.5">{noticeIcon(item.type)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-medium">{item.title}</p>
                        {!titleIncludesType && (
                          <span className="text-xs text-ink-soft">{typeLabel}</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">
                        <BitrixText text={item.message} />
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                        {item.taskId && (
                          <span>
                            {t('Задача #')}
                            {item.taskId}
                          </span>
                        )}
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
                  </div>
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
                <p className="text-sm text-ink-soft">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} {t('из')} {total}
                  {t(', страница')} {page} {t('из')} {pageCount}
                </p>
                <div
                  className="flex flex-wrap items-center justify-end gap-1"
                  aria-label={t('Пагинация')}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="hidden sm:inline-flex"
                    onClick={() => goToPage(1)}
                    disabled={pageLoading || page === 1}
                  >
                    {t('Первая')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => goToPage(page - 1)}
                    disabled={pageLoading || page === 1}
                  >
                    {t('Назад')}
                  </Button>
                  {pageNumbers(page, pageCount).map((number) => (
                    <Button
                      key={number}
                      variant={number === page ? 'secondary' : 'quiet'}
                      size="sm"
                      className="w-9 px-0"
                      onClick={() => goToPage(number)}
                      disabled={pageLoading}
                    >
                      {number}
                    </Button>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => goToPage(page + 1)}
                    disabled={pageLoading || page >= pageCount}
                  >
                    {t('Вперёд')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="hidden sm:inline-flex"
                    onClick={() => goToPage(pageCount)}
                    disabled={pageLoading || page >= pageCount}
                  >
                    {t('Последняя')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : error ? null : (
          <Card padding="md">
            <p className="text-sm font-bold text-ink">{t('Пока нет уведомлений')}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {t('Изменения задач и комментарии из Битрикс24 появятся здесь.')}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

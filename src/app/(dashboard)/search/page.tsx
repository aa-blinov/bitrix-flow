'use client';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/types/bitrix';
import { Search, X, MessageSquare, Calendar, User } from 'lucide-react';
import { Suspense, useState, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import TaskModal from '@/components/TaskModal';
import { Badge } from '@/components/monos/Badge';
import { Card } from '@/components/monos/Card';
import { IconButton } from '@/components/monos/IconButton';
import { SearchField } from '@/components/monos/SearchField';
import { Skeleton } from '@/components/monos/Skeleton';
import PageHeader from '@/components/PageHeader';
import { dateFormat, numberFormat, t } from '@/lib/i18n';

const DUE_DATE = dateFormat();

// Точка статуса: цвет здесь — сигнал, поэтому у каждого состояния своя роль
// набора, а не «какой-нибудь синий».
const STATUS_DOT: Record<string, string> = {
  done: 'bg-success',
  in_progress: 'bg-accent',
  testing: 'bg-warning',
  new: 'bg-ink-muted',
  deferred: 'bg-ink-faint',
};

function SearchPageContent() {
  const {
    search,
    searchResults,
    searchTotal,
    searchError,
    isSearching,
    searchQuery,
    setSelectedTask,
    tasks,
  } = useKanbanStore(
    useShallow((s) => ({
      search: s.search,
      searchResults: s.searchResults,
      searchTotal: s.searchTotal,
      searchError: s.searchError,
      isSearching: s.isSearching,
      searchQuery: s.searchQuery,
      setSelectedTask: s.setSelectedTask,
      tasks: s.tasks,
    })),
  );
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Запрос живёт в ?q=: ссылкой на поиск можно поделиться, и «назад» его не теряет.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? searchQuery);
  const selectedTaskId = searchParams.get('task');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== searchQuery) {
        search(query);
      }
      const params = new URLSearchParams(window.location.search);
      if ((params.get('q') ?? '') !== query) {
        if (query) params.set('q', query);
        else params.delete('q');
        const next = params.toString();
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setSelectedTask(selectedTaskId);
  }, [selectedTaskId, setSelectedTask]);

  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ||
    searchResults.find((task) => task.id === selectedTaskId);

  const openTask = (taskId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('task', taskId);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const closeTask = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('task');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-canvas">
      <PageHeader title={t('Поиск')} description={t('Задачи во всех доступных проектах')} />

      {/* Search Input */}
      <div className="border-b border-line bg-canvas p-4 lg:p-6">
        <div className="max-w-2xl">
          <SearchField
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            placeholder={t('Поиск задач по названию…')}
            label={t('Поиск задач по названию')}
            size="lg"
            autoFocus
          />
        </div>
      </div>

      {/* Results */}
      <div className="p-4 lg:p-6">
        {isSearching ? (
          <div className="mx-auto max-w-2xl space-y-3 py-2">
            <Skeleton height="6rem" />
            <Skeleton height="6rem" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="max-w-2xl space-y-3">
            <p className="text-sm text-ink-soft">
              {t('Найдено:')} {searchTotal}
              {searchTotal > searchResults.length &&
                t(', показаны первые {0} — уточните запрос', searchResults.length)}
            </p>
            {searchResults.map((task) => (
              <Card
                key={task.id}
                interactive
                padding="md"
                className="w-full cursor-pointer"
                onClick={() => openTask(task.id)}
              >
                <div className="flex items-start gap-4">
                  <div
                    aria-hidden="true"
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      STATUS_DOT[task.status] || 'bg-ink-muted'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-medium text-ink">{task.title}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                      <span className="tabular-nums">#{task.id}</span>
                      {/* Цвет точки — не единственный носитель статуса: подписываем. */}
                      <span>{STATUS_LABELS[task.status] || task.status}</span>
                      {task.priority !== 'medium' && (
                        <Badge
                          tone={
                            task.priority === 'critical'
                              ? 'danger'
                              : task.priority === 'high'
                                ? 'warning'
                                : 'neutral'
                          }
                          className={`${PRIORITY_LABELS[task.priority]?.bgColor} ${PRIORITY_LABELS[task.priority]?.color}`}
                        >
                          {PRIORITY_LABELS[task.priority]?.label}
                        </Badge>
                      )}
                      {task.assigneeName && (
                        <span className="flex items-center gap-1">
                          <User size={12} strokeWidth={1.7} />
                          {task.assigneeName}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className="flex items-center gap-1">
                          <Calendar size={12} strokeWidth={1.7} />
                          {DUE_DATE.format(new Date(task.dueDate))}
                        </span>
                      )}
                      {task.comments.length > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare size={12} strokeWidth={1.7} />
                          {task.comments.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : searchError ? (
          <p role="alert" className="max-w-2xl py-8 text-center text-danger-text">
            {searchError}
          </p>
        ) : query ? (
          <p className="max-w-2xl py-8 text-center text-ink-soft">
            {t('Задачи по запросу «')}
            {query}
            {t('» не найдены')}
          </p>
        ) : (
          <p className="max-w-2xl py-8 text-center text-ink-soft">
            {t('Начните вводить текст для поиска')}
          </p>
        )}
      </div>

      {selectedTask && <TaskModal task={selectedTask} onClose={closeTask} />}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <SearchPageContent />
    </Suspense>
  );
}

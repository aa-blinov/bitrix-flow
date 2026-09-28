'use client';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/types/bitrix';
import { Search, X, MessageSquare, Timer, Calendar, User } from 'lucide-react';
import { Suspense, useState, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import TaskModal from '@/components/TaskModal';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import PageHeader from '@/components/PageHeader';

const DUE_DATE = new Intl.DateTimeFormat('ru-RU');

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
    <div className="min-h-screen bg-background">
      <PageHeader title="Поиск" description="Задачи во всех доступных проектах" />

      {/* Search Input */}
      <div className="border-b bg-background p-4 lg:p-6">
        <div className="relative max-w-2xl">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={20}
          />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск задач по названию…"
            aria-label="Поиск задач по названию"
            className="h-11 pl-12 pr-12"
            autoFocus
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              <X size={18} />
            </Button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="p-4 lg:p-6">
        {isSearching ? (
          <div className="mx-auto max-w-2xl space-y-3 py-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">
              Найдено: {searchTotal}
              {searchTotal > searchResults.length &&
                `, показаны первые ${searchResults.length} — уточните запрос`}
            </p>
            {searchResults.map((task) => (
              <Card
                key={task.id}
                asChild
                className="w-full cursor-pointer gap-0 p-4 text-left transition hover:ring-primary/20 hover:shadow-sm"
              >
                <button type="button" onClick={() => openTask(task.id)}>
                  <div className="flex items-start gap-4">
                    <div
                      aria-hidden="true"
                      className={`w-2.5 h-2.5 shrink-0 rounded-full mt-1.5 ${
                        task.status === 'done'
                          ? 'bg-green-500'
                          : task.status === 'in_progress'
                            ? 'bg-blue-500'
                            : task.status === 'testing'
                              ? 'bg-yellow-500'
                              : 'bg-muted-foreground/50'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <h2 className="font-medium text-foreground">{task.title}</h2>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular-nums">#{task.id}</span>
                        {/* Цвет точки — не единственный носитель статуса: подписываем. */}
                        <span>{STATUS_LABELS[task.status] || task.status}</span>
                        {task.priority !== 'medium' && (
                          <Badge
                            variant="secondary"
                            className={`${PRIORITY_LABELS[task.priority]?.bgColor} ${PRIORITY_LABELS[task.priority]?.color}`}
                          >
                            {PRIORITY_LABELS[task.priority]?.label}
                          </Badge>
                        )}
                        {task.assigneeName && (
                          <span className="flex items-center gap-1">
                            <User size={12} />
                            {task.assigneeName}
                          </span>
                        )}
                        {task.dueDate && (
                          <span className="flex items-center gap-1">
                            <Calendar size={12} />
                            {DUE_DATE.format(new Date(task.dueDate))}
                          </span>
                        )}
                        {task.comments.length > 0 && (
                          <span className="flex items-center gap-1">
                            <MessageSquare size={12} />
                            {task.comments.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </Card>
            ))}
          </div>
        ) : searchError ? (
          <p role="alert" className="max-w-2xl py-8 text-center text-destructive">
            {searchError}
          </p>
        ) : query ? (
          <p className="max-w-2xl py-8 text-center text-muted-foreground">
            Задачи по запросу «{query}» не найдены
          </p>
        ) : (
          <p className="max-w-2xl py-8 text-center text-muted-foreground">
            Начните вводить текст для поиска
          </p>
        )}
      </div>

      {selectedTask && <TaskModal task={selectedTask} onClose={closeTask} />}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SearchPageContent />
    </Suspense>
  );
}

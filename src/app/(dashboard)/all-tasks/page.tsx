'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useKanbanStore } from '@/store/kanban';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/types/bitrix';
import { Calendar, MessageSquare, Timer, User, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import TaskModal from '@/components/TaskModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type StatusFilter = 'all' | 'overdue' | 'in_progress' | 'done';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Готово' },
];

// Внутренний компонент, использует useSearchParams() — обёрнут в Suspense
// ниже, чтобы Next.js не падал на статической пререндеринге.
function AllTasksInner() {
  const {
    projects,
    users,
    allTasks,
    isLoadingAllTasks,
    loadAllTasks,
    loadProjects,
    setSelectedTask,
  } = useKanbanStore();
  const searchParams = useSearchParams();
  const initialStatus = (searchParams.get('status') as StatusFilter) || 'all';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    STATUS_TABS.some((t) => t.value === initialStatus) ? initialStatus : 'all',
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  // Грузим проекты (для селекта проектов) и задачи при первом заходе
  useEffect(() => {
    if (projects.length === 0) void loadProjects();
    void loadAllTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projectById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const filteredTasks = useMemo(() => {
    const now = new Date();
    return allTasks.filter((t) => {
      if (statusFilter === 'overdue') {
        if (!t.dueDate || t.status === 'done') return false;
        if (new Date(t.dueDate) >= now) return false;
      } else if (statusFilter !== 'all' && t.status !== statusFilter) {
        return false;
      }
      if (assigneeFilter !== 'all' && t.assigneeId !== assigneeFilter) return false;
      if (projectFilter !== 'all' && t.projectId !== projectFilter) return false;
      if (query) {
        const q = query.toLocaleLowerCase('ru');
        if (!t.title.toLocaleLowerCase('ru').includes(q)) return false;
      }
      return true;
    });
  }, [allTasks, statusFilter, assigneeFilter, projectFilter, query]);

  const selectedTask = useKanbanStore((s) =>
    s.selectedTaskId ? allTasks.find((t) => t.id === s.selectedTaskId) : null,
  );

  const counts = useMemo(() => {
    const now = new Date();
    return {
      all: allTasks.length,
      overdue: allTasks.filter(
        (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now,
      ).length,
      in_progress: allTasks.filter((t) => t.status === 'in_progress').length,
      done: allTasks.filter((t) => t.status === 'done').length,
    };
  }, [allTasks]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-4 backdrop-blur lg:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="pt-2 md:pt-0">
            <h1 className="text-xl font-semibold text-foreground">Все задачи</h1>
            <p className="text-sm text-muted-foreground">
              Задачи по всем доступным проектам
              {isLoadingAllTasks && ' · загружаю…'}
            </p>
          </div>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию…"
            className="lg:w-72"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const count = counts[tab.value];
            const active = statusFilter === tab.value;
            return (
              <Button
                key={tab.value}
                variant={active ? 'default' : 'outline'}
                onClick={() => setStatusFilter(tab.value)}
              >
                {tab.label} ({count})
              </Button>
            );
          })}

          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            aria-label="Исполнитель"
          >
            <option value="all">Все исполнители</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            aria-label="Проект"
          >
            <option value="all">Все проекты</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {(statusFilter !== 'all' ||
            assigneeFilter !== 'all' ||
            projectFilter !== 'all' ||
            query) && (
            <Button
              variant="ghost"
              onClick={() => {
                setStatusFilter('all');
                setAssigneeFilter('all');
                setProjectFilter('all');
                setQuery('');
              }}
            >
              Сбросить
            </Button>
          )}
        </div>
      </header>

      <div className="p-4 lg:p-6">
        {counts.overdue > 0 && statusFilter === 'all' && (
          <div className="mb-4 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-destructive">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">
              {counts.overdue} просроченных задач по всем проектам
            </span>
          </div>
        )}

        <div className="max-w-4xl space-y-3">
          {isLoadingAllTasks ? (
            <div className="text-center py-12 text-muted-foreground">Загружаю задачи…</div>
          ) : filteredTasks.length > 0 ? (
            filteredTasks.map((task) => {
              const isOverdue =
                task.dueDate &&
                new Date(task.dueDate) < new Date() &&
                task.status !== 'done';
              const project = projectById[task.projectId];
              const assignee = task.assigneeId ? userById[task.assigneeId] : null;
              return (
                <Card
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTask(task.id)}
                  onKeyDown={(event) => event.key === 'Enter' && setSelectedTask(task.id)}
                  className={`w-full cursor-pointer gap-0 p-4 text-left transition hover:ring-primary/20 hover:shadow-sm ${
                    isOverdue
                      ? 'border-l-4 border-l-destructive border-t-destructive/30 border-b-destructive/30'
                      : 'border-border'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${
                        task.status === 'done'
                          ? 'bg-green-500'
                          : task.status === 'in_progress'
                            ? 'bg-blue-500'
                            : task.status === 'testing'
                              ? 'bg-yellow-500'
                              : 'bg-muted-foreground'
                      }`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3
                            className={`font-medium ${task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                          >
                            {task.title}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            {project && <span className="font-medium">{project.name}</span>}
                            <span className="font-mono">#{task.id}</span>
                            {assignee && (
                              <span className="flex items-center gap-1">
                                <User size={12} />
                                {assignee.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`whitespace-nowrap ${PRIORITY_LABELS[task.priority]?.bgColor} ${PRIORITY_LABELS[task.priority]?.color}`}
                        >
                          {PRIORITY_LABELS[task.priority]?.label}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            task.status === 'done'
                              ? 'bg-green-500/15 text-green-700 dark:text-green-300'
                              : task.status === 'in_progress'
                                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {STATUS_LABELS[task.status] || task.status}
                        </span>
                        {task.dueDate && (
                          <span
                            className={`flex items-center gap-1 ${isOverdue ? 'text-destructive font-medium' : ''}`}
                          >
                            <Calendar size={12} />
                            {new Date(task.dueDate).toLocaleDateString('ru-RU', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        )}
                        {task.actualTime > 0 && (
                          <span className="flex items-center gap-1">
                            <Timer size={12} />
                            {task.actualTime} ч
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
                </Card>
              );
            })
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg font-medium">Нет задач</p>
              <p className="text-sm">
                {query || statusFilter !== 'all' || assigneeFilter !== 'all' || projectFilter !== 'all'
                  ? 'По выбранным фильтрам ничего не найдено'
                  : 'Задач пока нет'}
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}

export default function AllTasksPage() {
  // Suspense вокруг useSearchParams() — Next.js требует этого для статической пререндеринга.
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Загрузка…</div>}>
      <AllTasksInner />
    </Suspense>
  );
}

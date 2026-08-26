'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useKanbanStore } from '@/store/kanban';
import { Calendar, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import TaskModal from '@/components/TaskModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TaskGrid from '@/components/TaskGrid';

type StatusFilter = 'all' | 'overdue' | 'in_progress' | 'done';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Готово' },
];

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

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
    void loadAllTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="min-h-screen bg-muted/30 pb-12">
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

      {counts.overdue > 0 && statusFilter === 'all' && (
        <div className="mx-4 mt-4 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-destructive lg:mx-6">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">
            {counts.overdue} просроченных задач по всем проектам
          </span>
        </div>
      )}

      <div className="mt-4">
        {isLoadingAllTasks ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center text-muted-foreground lg:px-6">
            Загружаю задачи…
          </div>
        ) : (
          <TaskGrid
            tasks={filteredTasks}
            showProject
            title={`Задачи · ${filteredTasks.length}`}
          />
        )}
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

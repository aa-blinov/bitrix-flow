'use client';

import { Suspense, useEffect, useMemo } from 'react';
import { useKanbanStore } from '@/store/kanban';
import { AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import TaskGrid from '@/components/TaskGrid';
import LoadingState from '@/components/LoadingState';

function AllTasksInner() {
  const {
    projects,
    allTasks,
    isLoadingAllTasks,
    loadAllTasks,
    loadProjects,
  } = useKanbanStore();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') || 'all';

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
    void loadAllTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const now = new Date();
    return {
      overdue: allTasks.filter(
        (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now,
      ).length,
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
        </div>
      </header>

      {counts.overdue > 0 && initialStatus === 'all' && (
        <div className="mx-4 mt-4 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-destructive lg:mx-6">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">
            {counts.overdue} просроченных задач по всем проектам
          </span>
        </div>
      )}

      <div className="mt-4">
        {isLoadingAllTasks ? (
          <LoadingState label="Загружаем задачи…" className="min-h-[60vh] bg-transparent lg:px-6" />
        ) : (
          <TaskGrid
            tasks={allTasks}
            showProject
            initialStatus={initialStatus}
            title="Задачи"
          />
        )}
      </div>
    </div>
  );
}

export default function AllTasksPage() {
  // Suspense вокруг useSearchParams() — Next.js требует этого для статической пререндеринга.
  return (
    <Suspense fallback={<LoadingState />}>
      <AllTasksInner />
    </Suspense>
  );
}

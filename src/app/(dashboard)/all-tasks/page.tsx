'use client';

import { Suspense, useEffect } from 'react';
import { useKanbanStore } from '@/store/kanban';
import { useSearchParams } from 'next/navigation';

import TaskGrid from '@/components/TaskGrid';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';

function AllTasksInner() {
  const {
    projects,
    allTasks,
    isLoadingAllTasks,
    loadAllTasks,
    loadProjects,
    currentUser,
    selectedTaskId,
    setSelectedTask,
  } = useKanbanStore();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') || 'all';
  const initialAssigneeId = searchParams.get('assignee') === 'me' ? currentUser.id : 'all';
  const taskFromUrl = searchParams.get('task');

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
    if (allTasks.length === 0) void loadAllTasks();
  }, [allTasks.length, loadAllTasks, loadProjects, projects.length]);

  // URL — единый источник правды для открытой задачи: клик/закрытие в TaskGrid
  // пишет ?task=<id>, back/forward браузера приводят нас сюда, мы отражаем
  // состояние в zustand. Если в URL ничего нет — закрываем модалку.
  useEffect(() => {
    const next = taskFromUrl || null;
    if (next !== selectedTaskId) setSelectedTask(next);
  }, [taskFromUrl, selectedTaskId, setSelectedTask]);

  return (
    <div className="min-h-screen bg-muted/30 pb-12">
      <PageHeader title="Все задачи" description="Задачи по всем доступным проектам" />

      <div className="mt-4">
        {isLoadingAllTasks ? (
          <LoadingState className="min-h-[60vh] bg-transparent lg:px-6" />
        ) : (
          <TaskGrid
            tasks={allTasks}
            showProject
            initialStatus={initialStatus}
            initialAssigneeId={initialAssigneeId}
            viewScope="all"
            layoutScope="all"
            title={null}
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

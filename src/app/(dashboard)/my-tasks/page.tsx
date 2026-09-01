'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useKanbanStore } from '@/store/kanban';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import TaskGrid from '@/components/TaskGrid';

function MyTasksInner() {
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
  const taskFromUrl = searchParams.get('task');

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
    if (allTasks.length === 0) void loadAllTasks();
  }, [allTasks.length, loadAllTasks, loadProjects, projects.length]);

  useEffect(() => {
    const next = taskFromUrl || null;
    if (next !== selectedTaskId) setSelectedTask(next);
  }, [taskFromUrl, selectedTaskId, setSelectedTask]);

  return (
    <div className="min-h-screen bg-muted/30 pb-12">
      <PageHeader title="Мои задачи" description="Задачи, где вы указаны исполнителем" />

      <div className="mt-4">
        {isLoadingAllTasks ? (
          <LoadingState className="min-h-[60vh] bg-transparent lg:px-6" />
        ) : (
          <TaskGrid
            tasks={allTasks}
            showProject
            initialStatus={initialStatus}
            initialAssigneeId={currentUser.id}
            title={null}
            viewScope="my"
            layoutScope="my"
          />
        )}
      </div>
    </div>
  );
}

export default function MyTasksPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MyTasksInner />
    </Suspense>
  );
}

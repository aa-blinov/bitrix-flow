'use client';

import { Suspense, useEffect, useMemo } from 'react';
import { useKanbanStore } from '@/store/kanban';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import TaskGrid from '@/components/TaskGrid';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';

function dueDayKey(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

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
  const workload = searchParams.get('workload');
  const requestedAssignee = searchParams.get('assignee');
  const initialStatus =
    workload === 'no_deadline' || workload === 'overdue'
      ? workload
      : workload
        ? 'active'
        : searchParams.get('status') || 'all';
  const initialAssigneeId =
    requestedAssignee === 'me'
      ? currentUser.id
      : requestedAssignee && requestedAssignee !== 'unassigned'
        ? requestedAssignee
        : 'all';
  const taskFromUrl = searchParams.get('task');
  const tasksForList = useMemo(() => {
    if (!workload && !requestedAssignee) return allTasks;
    return allTasks.filter((task) => {
      if (requestedAssignee === 'unassigned' && task.assigneeId) return false;
      if (
        requestedAssignee &&
        requestedAssignee !== 'unassigned' &&
        task.assigneeId !== requestedAssignee
      )
        return false;
      return (
        !workload ||
        workload === 'no_deadline' ||
        workload === 'overdue' ||
        dueDayKey(task.dueDate) === workload
      );
    });
  }, [allTasks, requestedAssignee, workload]);
  const workloadDescription = workload
    ? 'Задачи, открытые из календаря нагрузки. Фильтры списка можно уточнить ниже.'
    : 'Задачи по всем доступным проектам';

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
      <PageHeader
        title="Все задачи"
        description={workloadDescription}
        actions={
          searchParams.get('from') === 'workload' ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/team-workload">
                <ArrowLeft /> К нагрузке
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="mt-4">
        {isLoadingAllTasks ? (
          <LoadingState className="min-h-[60vh] bg-transparent lg:px-6" />
        ) : (
          <TaskGrid
            tasks={tasksForList}
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

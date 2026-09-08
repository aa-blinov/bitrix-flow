'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { convertBxTask, useKanbanStore } from '@/store/kanban';
import type { TaskGridPageQuery } from '@/components/TaskGrid';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import TaskGrid from '@/components/TaskGrid';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';

function AllTasksInner() {
  const {
    projects,
    allTasks,
    isLoadingAllTasks,
    allTasksTotal,
    loadAllTasks,
    loadProjects,
    currentUser,
    selectedTaskId,
    setSelectedTask,
  } = useKanbanStore();
  const searchParams = useSearchParams();
  const workload = searchParams.get('workload');
  const requestedAssignee = searchParams.get('assignee');
  const requestedProject = searchParams.get('project') || 'all';
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
  const loadPage = useCallback(
    async (request: TaskGridPageQuery) => {
      const params = new URLSearchParams({
        page: String(request.page),
        limit: String(request.limit),
        query: request.query,
        status: request.status,
        hideDone: String(request.hideDone),
        assigneeId: request.assigneeId,
        tag: request.tag,
        projectId: request.projectId,
        sorts: request.sorts.map((sort) => `${sort.key}:${sort.direction}`).join(','),
      });
      if (requestedAssignee === 'unassigned') params.set('unassigned', 'true');
      if (workload && workload !== 'no_deadline' && workload !== 'overdue') {
        params.set('deadlineDay', workload);
      }
      const response = await fetch(`/api/tasks/all?${params.toString()}`);
      if (!response.ok) throw new Error(`tasks/all HTTP ${response.status}`);
      const data = await response.json();
      return {
        tasks: (Array.isArray(data.tasks) ? data.tasks : []).map(convertBxTask),
        total: Number(data.total) || 0,
      };
    },
    [requestedAssignee, workload],
  );
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
    <div className="min-h-screen bg-background pb-12">
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
        {isLoadingAllTasks && allTasks.length === 0 ? (
          <LoadingState className="min-h-[60vh] bg-transparent lg:px-6" />
        ) : (
          <TaskGrid
            tasks={allTasks}
            showProject
            initialStatus={initialStatus}
            initialAssigneeId={initialAssigneeId}
            initialProjectId={requestedProject}
            viewScope="all"
            layoutScope="all"
            title={null}
            totalCount={allTasksTotal}
            loadPage={loadPage}
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

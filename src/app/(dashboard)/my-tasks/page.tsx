'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { convertBxTask, useKanbanStore } from '@/store/kanban';
import type { TaskGridPageQuery } from '@/components/TaskGrid';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import { filterQueryParams } from '@/lib/task-filters';
import TaskGrid from '@/components/TaskGrid';

function MyTasksInner() {
  const projects = useKanbanStore((state) => state.projects);
  const loadProjects = useKanbanStore((state) => state.loadProjects);
  const currentUser = useKanbanStore((state) => state.currentUser);
  const selectedTaskId = useKanbanStore((state) => state.selectedTaskId);
  const setSelectedTask = useKanbanStore((state) => state.setSelectedTask);
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') || 'all';
  const taskFromUrl = searchParams.get('task');
  const loadPage = useCallback(async (request: TaskGridPageQuery) => {
    const params = new URLSearchParams({
      ...filterQueryParams(request.filters),
      page: String(request.page),
      limit: String(request.limit),
      query: request.query,
      sorts: request.sorts.map((sort) => `${sort.key}:${sort.direction}`).join(','),
      hierarchy: String(request.hierarchy),
    });
    const response = await fetch(`/api/tasks/all?${params.toString()}`);
    if (!response.ok) throw new Error(`tasks/all HTTP ${response.status}`);
    const data = await response.json();
    return {
      tasks: (Array.isArray(data.tasks) ? data.tasks : []).map(convertBxTask),
      ancestors: (Array.isArray(data.ancestors) ? data.ancestors : []).map(convertBxTask),
      total: Number(data.total) || 0,
    };
  }, []);

  useEffect(() => {
    // Без currentUser.id сетка ушла бы за задачами с assigneeId='' — сервер
    // читает это как 'all' и отдаёт чужие задачи, которые потом заменяются
    // вторым запросом. Поэтому догружаем пользователя force-ом.
    if (!currentUser.id) void loadProjects(true);
    else if (projects.length === 0) void loadProjects();
  }, [currentUser.id, loadProjects, projects.length]);

  useEffect(() => {
    const next = taskFromUrl || null;
    if (next !== selectedTaskId) setSelectedTask(next);
  }, [taskFromUrl, selectedTaskId, setSelectedTask]);

  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader title="Мои задачи" description="Задачи, где вы указаны исполнителем" />

      <div className="mt-4">
        {!currentUser.id ? (
          <LoadingState className="min-h-[60vh] bg-transparent lg:px-6" />
        ) : (
          <TaskGrid
            showProject
            initialStatus={initialStatus}
            initialAssigneeId={currentUser.id}
            title={null}
            viewScope="my"
            layoutScope="my"
            loadPage={loadPage}
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

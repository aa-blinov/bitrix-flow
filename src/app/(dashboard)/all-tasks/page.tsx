'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useKanbanStore } from '@/store/kanban';
import type { TaskGridPageQuery } from '@/components/TaskGrid';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { fetchTaskGridPage } from '@/lib/task-grid-page';
import TaskGrid from '@/components/TaskGrid';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import QuickCreateTask from '@/components/QuickCreateTask';
import { Button } from '@/components/ui/button';

function AllTasksInner() {
  const { projects, loadProjects, currentUser, selectedTaskId, setSelectedTask } = useKanbanStore();
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
    (request: TaskGridPageQuery) => {
      const extra: Record<string, string> = {};
      if (requestedAssignee === 'unassigned') extra.unassigned = 'true';
      if (workload && workload !== 'no_deadline' && workload !== 'overdue') {
        extra.deadlineDay = workload;
      }
      return fetchTaskGridPage(request, extra);
    },
    [requestedAssignee, workload],
  );
  const workloadDescription = workload
    ? 'Задачи, открытые из календаря нагрузки. Фильтры списка можно уточнить ниже.'
    : 'Задачи по всем доступным проектам';

  useEffect(() => {
    // Список задач грид грузит сам постранично; полный loadAllTasks здесь
    // качал ту же страницу ещё раз.
    if (projects.length === 0) void loadProjects();
  }, [loadProjects, projects.length]);

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
          <div className="flex items-center gap-2">
            {searchParams.get('from') === 'workload' && (
              <Button asChild variant="outline" size="sm">
                <Link href="/team-workload">
                  <ArrowLeft /> К нагрузке
                </Link>
              </Button>
            )}
            <QuickCreateTask />
          </div>
        }
      />

      <div className="mt-4">
        {/* Свой лоадер у грида; второй, страничный, сменялся на него и
            сдвигал вёрстку (CLS 0.11). */}
        <TaskGrid
          showProject
          initialStatus={initialStatus}
          initialAssigneeId={initialAssigneeId}
          initialProjectId={requestedProject}
          viewScope="all"
          layoutScope="all"
          title={null}
          loadPage={loadPage}
        />
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

'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import type { TaskGridPageQuery } from '@/components/TaskGrid';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { fetchTaskGridPage } from '@/lib/task-grid-page';
import TaskGrid from '@/components/TaskGrid';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';
import QuickCreateTask from '@/components/QuickCreateTask';
import { t } from '@/lib/i18n';

function AllTasksInner() {
  const { projects, loadProjects, currentUser, selectedTaskId, setSelectedTask } = useKanbanStore(
    useShallow((s) => ({
      projects: s.projects,
      loadProjects: s.loadProjects,
      currentUser: s.currentUser,
      selectedTaskId: s.selectedTaskId,
      setSelectedTask: s.setSelectedTask,
    })),
  );
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
    ? t('Задачи, открытые из календаря нагрузки. Фильтры списка можно уточнить ниже.')
    : t('Задачи по всем доступным проектам');

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
    <div className="min-h-screen bg-canvas pb-12">
      <PageHeader
        title={t('Все задачи')}
        description={workloadDescription}
        actions={
          <div className="flex items-center gap-2">
            {searchParams.get('from') === 'workload' && (
              <Link
                href="/team-workload"
                className="inline-flex h-11 items-center gap-2 rounded-ui px-3 text-xs font-normal uppercase tracking-widest text-ink-soft transition-colors duration-fast hover:text-ink sm:h-9"
              >
                <ArrowLeft size={14} strokeWidth={1.7} />
                {t('К нагрузке')}
              </Link>
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

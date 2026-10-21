'use client';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarOff,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/monos/Card';
import { Progress } from '@/components/monos/Progress';
import { SelectField } from '@/components/monos/SelectField';
import { TextField } from '@/components/monos/TextField';
import { cn, getProjectInitials, pluralRu } from '@/lib/utils';
import PageHeader from '@/components/PageHeader';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import LoadingState from '@/components/LoadingState';

export default function DashboardPage() {
  const { projects, allTasks, isLoading, selectedProjectId, setSelectedProject } = useKanbanStore(
    useShallow((s) => ({
      projects: s.projects,
      allTasks: s.allTasks,
      isLoading: s.isLoading,
      selectedProjectId: s.selectedProjectId,
      setSelectedProject: s.setSelectedProject,
    })),
  );
  const [searchQuery, setSearchQuery] = useState('');
  // Числа на карточках и в сводке считает сервер по всему зеркалу: клиент
  // держит только первую страницу задач, и раньше главная показывала её срез.
  // null — пока сервер не ответил: нули на карточках читались как «всё чисто».
  const [stats, setStats] = useState<{
    projects: Record<string, { total: number; done: number; overdue: number }>;
    totals: { attention: number; inProgress: number; week: number; noDeadline: number };
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/tasks/stats?byProject=true')
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data.projects)) return;
        setStats({
          projects: Object.fromEntries(
            data.projects.map((item: { id: string }) => [item.id, item]),
          ),
          totals: data.totals || { attention: 0, inProgress: 0, week: 0, noDeadline: 0 },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const hasBootstrapped = useRef(false);
  // Проект выбираем, как только список появился — неважно, чей запрос его
  // принёс: сайдбар обращается за проектами в том же тике.
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) setSelectedProject(projects[0].id);
  }, [projects, selectedProjectId, setSelectedProject]);

  useEffect(() => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;
    const params = new URLSearchParams(window.location.search);
    const memberId = params.get('member_id');
    if (memberId) {
      localStorage.setItem('bitrix_member_id', memberId);
    }
    if (params.get('install') === 'success' || params.get('oauth') === 'success') {
      window.history.replaceState({}, '', '/');
    }

    // Проверку подключения, member_id из сессии и загрузку проектов делают
    // layout и сайдбар. Раньше главная повторяла это своим /api/oauth/check:
    // второй запрос, второй выбор первого проекта (и двойная загрузка его
    // фаз), а при неподключённом Битриксе — спор двух редиректов.
  }, []);

  // Спиннер во весь экран прятал и шапку: страница оставалась без заголовка,
  // пока грузились проекты. Каркас рисуем сразу, спиннер — на месте списка.
  const isBootstrapping = isLoading || !selectedProjectId;

  // «Без проекта» — такой же вход, как в левой панели: у портала 69 задач вне
  // групп, и без этой карточки с главной до них было не добраться.
  const noProject = {
    id: NO_PROJECT_ID,
    name: NO_PROJECT_NAME,
    description: '',
    membersCount: 0,
    isArchived: false,
  };
  const projectsWithStats = [noProject, ...projects].map((project) => {
    const row = stats?.projects[project.id];
    const projectTasks = allTasks.filter((task) => task.projectId === project.id);
    return {
      ...project,
      taskCount: row?.total ?? projectTasks.length,
      completed: row?.done ?? projectTasks.filter((task) => task.status === 'done').length,
      overdue: row?.overdue ?? 0,
      inProgress: projectTasks.filter((task) => task.status === 'in_progress').length,
    };
  });

  const filteredProjects = projectsWithStats
    .filter(
      (project) =>
        (archiveFilter === 'all' ||
          (archiveFilter === 'archived') === Boolean(project.isArchived)) &&
        project.name.toLocaleLowerCase('ru').includes(searchQuery.toLocaleLowerCase('ru')),
    )
    // Проблемные проекты — наверх: главная для контроля, и проект с 22
    // просрочками не должен теряться посреди списка. Остальные — как были.
    .sort((left, right) => right.overdue - left.overdue);

  const totals = stats?.totals;

  return (
    <div className="min-h-full bg-canvas">
      <PageHeader title="Главная" description="Обзор проектов, задач и сроков" />

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        {/* Stats */}
        <div className="mb-8 grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            href="/all-tasks?status=attention"
            icon={AlertTriangle}
            label="Требуют внимания"
            value={totals?.attention}
            alarm
          />
          <StatCard
            href="/all-tasks?status=in_progress"
            icon={ListChecks}
            label="В работе"
            value={totals?.inProgress}
          />
          <StatCard
            href="/all-tasks?status=week"
            icon={CalendarDays}
            label="Дедлайн на неделе"
            value={totals?.week}
          />
          <StatCard
            href="/all-tasks?status=no_deadline"
            icon={CalendarOff}
            label="Без дедлайна"
            value={totals?.noDeadline}
          />
        </div>

        {/* Projects list */}
        <Card padding="none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <p className="text-sm font-bold text-ink">Проекты</p>
            <div className="flex items-center gap-2">
              <TextField
                variant="boxed"
                size="sm"
                placeholder="Поиск…"
                aria-label="Найти проект"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-40 sm:w-64"
              />
              <SelectField
                size="sm"
                variant="boxed"
                value={archiveFilter}
                onChange={(event) => setArchiveFilter(event.target.value as typeof archiveFilter)}
                options={[
                  { value: 'active', label: 'Активные' },
                  { value: 'archived', label: 'Архив' },
                  { value: 'all', label: 'Все' },
                ]}
                aria-label="Проекты"
                className="w-28"
              />
            </div>
          </div>

          <div className="divide-y divide-line">
            {isBootstrapping && <LoadingState className="min-h-60 bg-transparent" />}
            {!isBootstrapping &&
              filteredProjects.map((project) => {
                const progressPercent =
                  project.taskCount > 0
                    ? Math.round((project.completed / project.taskCount) * 100)
                    : 0;

                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="group flex items-center gap-4 px-5 py-3.5 transition-colors duration-fast hover:bg-surface"
                  >
                    {/* Метка проекта: в наборе цвет означает состояние, поэтому
                        проект помечается инициалами, а не радугой цветов. */}
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-xs font-bold text-ink-soft"
                      aria-hidden="true"
                    >
                      {getProjectInitials(project.name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-medium text-ink">{project.name}</h2>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-ink-soft">
                        <span>
                          {project.taskCount > 0
                            ? `${project.taskCount} ${pluralRu(project.taskCount, ['задача', 'задачи', 'задач'])}`
                            : 'Нет задач'}
                        </span>
                        {project.overdue > 0 && (
                          <span className="font-medium text-danger-text">
                            Просрочено: {project.overdue}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Пустая полоса у проекта без задач — шум: место держим, рисуем только при задачах. */}
                    <div className="hidden w-48 items-center gap-3 md:flex">
                      {project.taskCount > 0 && (
                        <>
                          <Progress
                            value={progressPercent}
                            label={`Готовность проекта «${project.name}»`}
                            tone={progressPercent === 100 ? 'success' : 'accent'}
                            className="flex-1"
                          />
                          <span className="w-9 text-right text-xs font-medium tabular-nums text-ink-soft">
                            {progressPercent}%
                          </span>
                        </>
                      )}
                    </div>

                    <ArrowRight
                      size={16}
                      className="text-ink-faint transition-colors duration-fast group-hover:text-ink"
                    />
                  </Link>
                );
              })}

            {filteredProjects.length === 0 && !isLoading && (
              <div className="py-12 text-center text-sm text-ink-soft">
                {searchQuery ? 'Проекты не найдены' : 'Проектов пока нет'}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// Цвет у счётчика — только сигнал: «Требуют внимания» загорается, когда есть
// что разбирать. Остальные карточки нейтральные, иначе сигнал тонет.
function StatCard({
  icon: Icon,
  label,
  value,
  href,
  alarm = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  href: string;
  alarm?: boolean;
}) {
  const lit = alarm && Boolean(value);
  return (
    <Link href={href} className="block h-full rounded-ui">
      <Card padding="none" className="h-full transition duration-fast hover:bg-surface">
        <div className="flex h-24 flex-col justify-center gap-1.5 p-4">
          <p className="flex items-center gap-1.5 text-xs text-ink-soft">
            <Icon
              size={14}
              aria-hidden="true"
              className={cn('shrink-0', lit && 'text-warning-text')}
            />
            {label}
          </p>
          <p
            className={cn(
              'text-2xl font-semibold tabular-nums',
              lit ? 'text-warning-text' : 'text-ink',
              value === 0 && 'text-ink-faint',
            )}
          >
            {value ?? '—'}
          </p>
        </div>
      </Card>
    </Link>
  );
}

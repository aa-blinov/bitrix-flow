'use client';
import { useKanbanStore } from '@/store/kanban';
import { useRouter } from 'next/navigation';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, getProjectColor, getProjectInitials, pluralRu } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/PageHeader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import LoadingState from '@/components/LoadingState';

export default function DashboardPage() {
  const router = useRouter();
  const { projects, allTasks, loadProjects, isLoading, selectedProjectId, setSelectedProject } =
    useKanbanStore();
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

    // A successful OAuth callback includes member_id. Keep it before removing
    // the callback query string, otherwise the browser cannot find its token.
    fetch('/api/oauth/check', {
      credentials: 'include',
      headers: { 'X-Member-Id': localStorage.getItem('bitrix_member_id') || '' },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.session === false) {
          router.replace('/login');
          return;
        }
        if (data.connected && data.member_id) {
          localStorage.setItem('bitrix_member_id', data.member_id);
          // Цифры главной считает сервер (/api/tasks/stats): полный список
          // задач тут качался зря, ~90 КБ JSON и лишний рендер.
          void loadProjects().then(() => {
            const firstProject = useKanbanStore.getState().projects[0];
            if (firstProject) useKanbanStore.getState().setSelectedProject(firstProject.id);
          });
          return;
        }
        // Сессия есть, но Bitrix ещё не установлен: перекидываем на ЛК-раздел
        // /connection-help, который проверит состояние и перейдёт в ЛК после установки.
        router.replace('/connection-help');
      })
      .catch(() => router.replace('/login'));
  }, [loadProjects, router]);

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
  const projectsWithStats = [noProject, ...projects].map((p) => {
    const row = stats?.projects[p.id];
    const projectTasks = allTasks.filter((t) => t.projectId === p.id);
    return {
      ...p,
      taskCount: row?.total ?? projectTasks.length,
      completed: row?.done ?? projectTasks.filter((t) => t.status === 'done').length,
      overdue: row?.overdue ?? 0,
      inProgress: projectTasks.filter((t) => t.status === 'in_progress').length,
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
    <div className="min-h-full bg-muted/20">
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
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b">
            <CardTitle>Проекты</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="Поиск…"
                aria-label="Найти проект"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-40 sm:w-64"
              />
              <Select
                value={archiveFilter}
                onValueChange={(value) => setArchiveFilter(value as typeof archiveFilter)}
              >
                <SelectTrigger className="w-28" aria-label="Проекты">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активные</SelectItem>
                  <SelectItem value="archived">Архив</SelectItem>
                  <SelectItem value="all">Все</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <div className="divide-y divide-border">
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
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted transition-colors group"
                  >
                    <div
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${getProjectColor(project.name)}`}
                      aria-hidden="true"
                    >
                      {getProjectInitials(project.name)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h2 className="truncate text-sm font-medium text-foreground">
                        {project.name}
                      </h2>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          {project.taskCount > 0
                            ? `${project.taskCount} ${pluralRu(project.taskCount, ['задача', 'задачи', 'задач'])}`
                            : 'Нет задач'}
                        </span>
                        {project.overdue > 0 && (
                          <span className="font-medium text-destructive">
                            Просрочено: {project.overdue}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Пустая полоса у проекта без задач — шум: место держим, рисуем только при задачах. */}
                    <div className="hidden w-48 items-center gap-3 md:flex">
                      {project.taskCount > 0 && (
                        <>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all ${
                                progressPercent === 100 ? 'bg-emerald-500' : 'bg-primary'
                              }`}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <span className="w-9 text-right text-xs font-medium tabular-nums text-muted-foreground">
                            {progressPercent}%
                          </span>
                        </>
                      )}
                    </div>

                    <ArrowRight
                      size={16}
                      className="text-muted-foreground transition-colors group-hover:text-foreground"
                    />
                  </Link>
                );
              })}

            {filteredProjects.length === 0 && !isLoading && (
              <div className="py-12 text-center text-sm text-muted-foreground">
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
    <Link href={href} className="block h-full rounded-xl">
      <Card className="h-full py-0 transition hover:bg-muted/50" size="sm">
        <CardContent className="flex h-24 flex-col justify-center gap-1.5 p-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon
              size={14}
              aria-hidden="true"
              className={cn('shrink-0', lit && 'text-amber-700 dark:text-amber-300')}
            />
            {label}
          </p>
          <p
            className={cn(
              'text-2xl font-semibold tabular-nums',
              lit ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
              value === 0 && 'text-muted-foreground',
            )}
          >
            {value ?? '—'}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

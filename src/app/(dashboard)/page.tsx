'use client';
import { useKanbanStore } from '@/store/kanban';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, CalendarOff, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getProjectColor, getProjectInitials } from '@/lib/utils';
import { isDueThisWeek, needsDeadlineAttention } from '@/lib/task-urgency';
import LoadingState from '@/components/LoadingState';

export default function DashboardPage() {
  const router = useRouter();
  const { projects, allTasks, loadProjects, loadAllTasks, isLoading, selectedProjectId, setSelectedProject } =
    useKanbanStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const hasBootstrapped = useRef(false);

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
      headers: { 'X-Member-Id': localStorage.getItem('bitrix_member_id') || '' },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error === 'NOT_AUTHENTICATED' || data.session === false) {
          router.replace('/login');
          return;
        }
        if (data.connected && data.member_id) {
          localStorage.setItem('bitrix_member_id', data.member_id);
          void loadProjects().then(() => {
            const firstProject = useKanbanStore.getState().projects[0];
            if (firstProject) useKanbanStore.getState().setSelectedProject(firstProject.id);
            // Список уже отдаётся из Mongo/task_mirror, поэтому не создаёт
            // Bitrix fan-out и заполняет сводные карточки после доски.
            void loadAllTasks();
          });
          return;
        }
        // Сессия есть, но Bitrix ещё не установлен: оставляем пользователя в
        // ЛК, показывая баннер с кнопкой установки.
        setShowInstallBanner(true);
        void loadProjects().catch(() => {});
      })
      .catch(() => router.replace('/login'));
  }, [loadAllTasks, loadProjects, router]);

  if (isLoading || !selectedProjectId && !showInstallBanner) {
    return <LoadingState className="min-h-screen bg-muted/30" />;
  }

  const projectsWithStats = projects.map((p) => {
    const projectTasks = allTasks.filter((t) => t.projectId === p.id);
    const completed = projectTasks.filter((t) => t.status === 'done').length;
    const inProgress = projectTasks.filter((t) => t.status === 'in_progress').length;
    const overdue = projectTasks.filter((t) => {
      if (!t.dueDate || t.status === 'done') return false;
      return new Date(t.dueDate) < new Date();
    }).length;
    const totalEstimate = projectTasks.reduce((sum, t) => sum + t.estimate, 0);
    const totalActual = projectTasks.reduce((sum, t) => sum + t.actualTime, 0);

    return {
      ...p,
      taskCount: projectTasks.length,
      completed,
      inProgress,
      overdue,
      totalEstimate,
      totalActual,
    };
  });

  const filteredProjects = projectsWithStats.filter((project) =>
    (archiveFilter === 'all' || (archiveFilter === 'archived') === Boolean(project.isArchived)) &&
    project.name.toLocaleLowerCase('ru').includes(searchQuery.toLocaleLowerCase('ru')),
  );

  const attentionCount = allTasks.filter((task) => needsDeadlineAttention(task)).length;
  const inProgressCount = allTasks.filter((task) => task.status === 'in_progress').length;
  const dueThisWeekCount = allTasks.filter((task) => isDueThisWeek(task)).length;
  const noDeadlineCount = allTasks.filter((task) => task.status !== 'done' && !task.dueDate).length;

  return (
    <div className="min-h-full bg-muted/20">
      {showInstallBanner && (
        <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>Вход выполнен, но подключение к Битрикс24 ещё не настроено. Без него список задач останется пустым.</span>
            <a href="/api/oauth" className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">Подключить Битрикс24</a>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-5 backdrop-blur sm:px-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Главная</h1>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        {/* Stats */}
        <div className="mb-8 grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard href="/all-tasks?status=attention" icon={AlertTriangle} label="Требуют внимания" value={attentionCount} color="text-amber-700 dark:text-amber-300" bgColor="bg-amber-500/15" />
          <StatCard href="/all-tasks?status=in_progress" icon={ListChecks} label="В работе" value={inProgressCount} color="text-blue-700 dark:text-blue-300" bgColor="bg-blue-500/15" />
          <StatCard href="/all-tasks?status=week" icon={CalendarDays} label="Дедлайн на неделе" value={dueThisWeekCount} color="text-violet-700 dark:text-violet-300" bgColor="bg-violet-500/15" />
          <StatCard href="/all-tasks?status=no_deadline" icon={CalendarOff} label="Без дедлайна" value={noDeadlineCount} color="text-muted-foreground" bgColor="bg-muted" />
        </div>

        {/* Projects list */}
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b">
            <CardTitle>Проекты</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="Поиск…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-40 sm:w-64"
              />
              <Select value={archiveFilter} onValueChange={(value) => setArchiveFilter(value as typeof archiveFilter)}>
                <SelectTrigger className="w-28" aria-label="Проекты"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активные</SelectItem>
                  <SelectItem value="archived">Архив</SelectItem>
                  <SelectItem value="all">Все</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <div className="divide-y divide-gray-100">
            {filteredProjects.map((project) => {
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
                    <h3 className="truncate text-sm font-medium text-foreground">{project.name}</h3>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Всего: {project.taskCount} задач</span>
                      {project.overdue > 0 && (
                        <span className="font-medium text-destructive">
                          Просрочено: {project.overdue}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden w-48 items-center gap-3 md:flex">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${
                          progressPercent === 100 ? 'bg-emerald-500' : 'bg-primary'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs font-medium text-muted-foreground">
                      {progressPercent}%
                    </span>
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

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  bgColor,
  href,
}: {
  icon: any;
  label: string;
  value: number | string;
  color: string;
  bgColor: string;
  href: string;
}) {
  return (
    <Link href={href} className="block h-full">
      <Card className="h-full py-0 transition hover:bg-muted/50" size="sm">
      <CardContent className="flex h-24 items-center p-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg ${bgColor} flex items-center justify-center`}>
            <Icon size={16} className={color} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-semibold ${color} mt-0.5`}>{value}</p>
          </div>
        </div>
      </CardContent>
      </Card>
    </Link>
  );
}

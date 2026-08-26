'use client';
import { useKanbanStore } from '@/store/kanban';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  FolderKanban,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getProjectColor, getProjectInitials } from '@/lib/utils';
import LoadingState from '@/components/LoadingState';

export default function DashboardPage() {
  const router = useRouter();
  const { projects, allTasks, loadProjects, isLoading, selectedProjectId, setSelectedProject } =
    useKanbanStore();
  const [searchQuery, setSearchQuery] = useState('');
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
        if (data.connected && data.member_id) {
          localStorage.setItem('bitrix_member_id', data.member_id);
          void loadProjects(true).then(() => {
            const firstProject = useKanbanStore.getState().projects[0];
            if (firstProject) useKanbanStore.getState().setSelectedProject(firstProject.id);
            // Не запускаем здесь loadAllTasks(): на холодном сервере это
            // отправляло десятки запросов в Bitrix24 одновременно и задерживало
            // первую доску. Счётчики обновит серверный sync/SSE.
          });
        } else {
          router.replace('/connection-help');
        }
      })
      .catch(() => router.replace('/connection-help'));
  }, [loadProjects, router]);

  if (isLoading || !selectedProjectId) {
    return <LoadingState label="Синхронизируем данные Bitrix24…" className="min-h-screen bg-muted/30" />;
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

  const filteredProjects = searchQuery
    ? projectsWithStats.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : projectsWithStats;

  const totalTasks = allTasks.length;
  const totalCompleted = allTasks.filter((t) => t.status === 'done').length;
  const totalOverdue = allTasks.filter((t) => {
    if (!t.dueDate || t.status === 'done') return false;
    return new Date(t.dueDate) < new Date();
  }).length;
  const totalEstimate = allTasks.reduce((sum, t) => sum + t.estimate, 0);
  const totalActual = allTasks.reduce((sum, t) => sum + t.actualTime, 0);

  return (
    <div className="min-h-full bg-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-5 backdrop-blur sm:px-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Главная</h1>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={FolderKanban}
            label="Проекты"
            value={projects.length}
            color="text-foreground"
            bgColor="bg-muted"
          />
          <StatCard
            icon={CheckCircle2}
            label="Готово"
            value={totalCompleted}
            color="text-green-600 dark:text-green-400"
            bgColor="bg-green-500/15"
          />
          <StatCard
            icon={AlertTriangle}
            label="Просрочено"
            value={totalOverdue}
            color="text-red-600 dark:text-red-400"
            bgColor="bg-red-500/15"
          />
          <StatCard
            icon={Clock}
            label="Часы"
            value={totalActual.toFixed(1)}
            color="text-blue-600 dark:text-blue-400"
            bgColor="bg-blue-500/15"
          />
        </div>

        {/* Projects list */}
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b">
            <CardTitle>Проекты</CardTitle>
            <Input
              type="text"
              placeholder="Поиск…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-40 sm:w-64"
            />
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
                      <span>{project.taskCount} задач</span>
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
}: {
  icon: any;
  label: string;
  value: number | string;
  color: string;
  bgColor: string;
}) {
  return (
    <Card className="py-0" size="sm">
      <CardContent className="p-4">
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
  );
}

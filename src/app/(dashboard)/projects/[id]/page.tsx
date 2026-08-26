'use client';
import { useKanbanStore } from '@/store/kanban';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import KanbanBoard from '@/components/KanbanBoard';
import {
  FolderKanban,
  Users,
  ChevronRight,
  Columns3,
  TableProperties,
} from 'lucide-react';
import TaskGrid from '@/components/TaskGrid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = (params?.id as string) || '0';
  const notificationTaskId = searchParams.get('task');
  const [view, setView] = useState('kanban');

  const {
    projects,
    selectedProjectId,
    setSelectedProject,
    setSelectedTask,
    tasks,
    isRehydrated,
  } = useKanbanStore();

  useEffect(() => {
    const state = useKanbanStore.getState();
    if (isRehydrated && state.projects.length === 0 && !state.isLoading) {
      void state.loadProjects();
    }
  }, [isRehydrated]);

  useEffect(() => {
    if (isRehydrated && projectId && projectId !== selectedProjectId) {
      setSelectedProject(projectId);
    }
  }, [isRehydrated, projectId, selectedProjectId, setSelectedProject]);

  // Computed values
  const currentProject = projects.find((p) => p.id === projectId);
  const getFilteredTasks = useKanbanStore((state) => state.getFilteredTasks);
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === projectId),
    [tasks, projectId],
  );
  useEffect(() => {
    if (notificationTaskId && projectTasks.some((task) => task.id === notificationTaskId)) {
      setSelectedTask(notificationTaskId);
    }
  }, [notificationTaskId, projectTasks, setSelectedTask]);
  const visibleTasks = getFilteredTasks();
  const completedTasks = projectTasks.filter((t) => t.status === 'done').length;
  const totalEstimate = projectTasks.reduce((sum, t) => sum + t.estimate, 0);
  const totalActual = projectTasks.reduce((sum, t) => sum + t.actualTime, 0);

  if (projects.length === 0) {
    return (
      <div className="min-h-screen space-y-6 p-4 md:p-8 animate-pulse" aria-label="Загрузка проекта">
        <div className="h-8 w-72 rounded bg-muted" />
        <div className="h-20 rounded-lg bg-muted" />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((column) => <div key={column} className="h-72 rounded-lg bg-muted" />)}
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Проект не найден</p>
          <Button onClick={() => router.push('/')} className="px-4">
            На главную
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" suppressHydrationWarning>
      {/* Project Header */}
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="px-4 lg:px-6 pt-3 pb-2">
          <div className="flex items-center gap-1 text-xs text-gray-500 overflow-x-auto scrollbar-hide">
            <Button
              variant="link"
              size="xs"
              onClick={() => router.push('/')}
              className="h-auto p-0 text-muted-foreground no-underline hover:text-foreground hover:no-underline"
            >
              Главная
            </Button>
            <ChevronRight size={12} />
            <span className="text-foreground font-medium">{currentProject.name}</span>
          </div>
        </div>

        <div className="px-4 lg:px-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
                <span className="rounded-lg bg-primary/10 p-2 text-primary">
                  <FolderKanban size={20} />
                </span>
                {currentProject.name}
              </h1>
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users size={14} />
                  {currentProject.membersCount || 0} участников
                </span>
                <span>•</span>
                <span>{projectTasks.length} задач</span>
                <span>•</span>
                <span className="text-emerald-600">{completedTasks} завершено</span>
              </div>
            </div>

            <div className="hidden md:flex gap-4 text-sm">
              <div className="text-center">
                <p className="text-muted-foreground text-xs">План</p>
                <p className="font-semibold">{totalEstimate.toFixed(1)} ч</p>
              </div>
              <div className="text-center">
                <p className="text-muted-foreground text-xs">Факт</p>
                <p className="font-semibold">{totalActual.toFixed(1)} ч</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={view} onValueChange={setView} className="pb-6">
        {view === 'grid' && (
          <div className="px-4 pt-5 sm:px-6">
            <TabsList>
              <TabsTrigger value="kanban">
                <Columns3 className="size-4" />
                Канбан
              </TabsTrigger>
              <TabsTrigger value="grid">
                <TableProperties className="size-4" />
                Таблица
              </TabsTrigger>
            </TabsList>
          </div>
        )}
        <TabsContent value="kanban" className="mt-0">
          <KanbanBoard
            toolbar={
              <TabsList>
                <TabsTrigger value="kanban">
                  <Columns3 className="size-4" />
                  Канбан
                </TabsTrigger>
                <TabsTrigger value="grid">
                  <TableProperties className="size-4" />
                  Таблица
                </TabsTrigger>
              </TabsList>
            }
          />
        </TabsContent>
        <TabsContent value="grid" className="mt-0">
          <TaskGrid tasks={visibleTasks} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

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
  Settings,
} from 'lucide-react';
import TaskGrid from '@/components/TaskGrid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = (params?.id as string) || '0';
  const notificationTaskId = searchParams.get('task');
  const [view, setView] = useState('kanban');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const {
    projects,
    selectedProjectId,
    setSelectedProject,
    setSelectedTask,
    loadTaskById,
    tasks,
    isRehydrated,
    updateProject,
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
    if (!notificationTaskId) return;
    const openTask = async () => {
      const task = projectTasks.find((item) => item.id === notificationTaskId) || await loadTaskById(notificationTaskId);
      if (task?.projectId !== projectId) return;
      setSelectedTask(notificationTaskId);
      // The query starts the modal once; remove it so closing the modal returns
      // to this project instead of immediately opening the same task again.
      router.replace(`/projects/${projectId}`);
    };
    void openTask();
  }, [loadTaskById, notificationTaskId, projectId, projectTasks, router, setSelectedTask]);
  const visibleTasks = getFilteredTasks();
  const completedTasks = projectTasks.filter((t) => t.status === 'done').length;
  const totalEstimate = projectTasks.reduce((sum, t) => sum + t.estimate, 0);
  const totalActual = projectTasks.reduce((sum, t) => sum + t.actualTime, 0);
  const activeTasks = projectTasks.filter((task) => task.status !== 'done');
  const overdueTasks = activeTasks.filter((task) => task.dueDate && new Date(task.dueDate) < new Date()).length;
  const unassignedTasks = activeTasks.filter((task) => !task.assigneeId).length;
  const noDeadlineTasks = activeTasks.filter((task) => !task.dueDate).length;
  const nextDeadline = activeTasks.filter((task) => task.dueDate).map((task) => task.dueDate!).sort()[0];

  async function saveProject() {
    if (!currentProject || !name.trim()) return;
    await updateProject(currentProject.id, { name: name.trim(), description });
    setSettingsOpen(false);
  }

  async function toggleArchive() {
    if (!currentProject || !window.confirm(currentProject.isArchived ? 'Вернуть проект из архива?' : 'Архивировать проект?')) return;
    await updateProject(currentProject.id, { archived: !currentProject.isArchived });
    setSettingsOpen(false);
  }

  if (projects.length === 0) {
    return <LoadingState className="min-h-screen" />;
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
    <div className="min-h-screen overflow-x-hidden bg-background" suppressHydrationWarning>
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
                {currentProject.isArchived && (
                  <span className="rounded border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">Архив</span>
                )}
              </h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Users size={14} />{currentProject.membersCount || 0} участников</span>
                <span>•</span><span>{projectTasks.length} задач</span><span>•</span><span className="text-emerald-600">{completedTasks} завершено</span>
              </div>
              {(overdueTasks || unassignedTasks || noDeadlineTasks || nextDeadline) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {overdueTasks > 0 && <span className="font-medium text-destructive">{overdueTasks} просрочено</span>}
                  {unassignedTasks > 0 && <span>{overdueTasks ? ' · ' : ''}{unassignedTasks} без исполнителя</span>}
                  {noDeadlineTasks > 0 && <span>{overdueTasks || unassignedTasks ? ' · ' : ''}{noDeadlineTasks} без срока</span>}
                  {nextDeadline && <span>{overdueTasks || unassignedTasks || noDeadlineTasks ? ' · ' : ''}Ближайший срок: {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(nextDeadline))}</span>}
                </p>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={() => { setName(currentProject.name); setDescription(currentProject.description); setSettingsOpen(true); }}><Settings className="size-4" /> Настройки</Button>
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

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Настройки проекта</DialogTitle></DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Название" />
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Описание" />
          <DialogFooter className="gap-2 sm:justify-between"><Button variant="outline" onClick={() => void toggleArchive()}>{currentProject.isArchived ? 'Разархивировать' : 'Архивировать'}</Button><Button onClick={() => void saveProject()} disabled={!name.trim()}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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

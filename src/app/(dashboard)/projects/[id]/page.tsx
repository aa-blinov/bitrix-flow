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
  UserPlus,
  X,
} from 'lucide-react';
import TaskGrid from '@/components/TaskGrid';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addProjectMember, fetchProjectMembers, removeProjectMember } from '@/lib/bitrix24';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = (params?.id as string) || '0';
  const notificationTaskId = searchParams.get('task');
  const initialStatus = searchParams.get('status') || 'all';
  const [view, setView] = useState(() => (searchParams.get('view') === 'grid' ? 'grid' : 'kanban'));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const {
    projects,
    selectedProjectId,
    setSelectedProject,
    setSelectedTask,
    loadTaskById,
    tasks,
    isRehydrated,
    updateProject,
    users,
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
    if (!notificationTaskId) {
      setSelectedTask(null);
      return;
    }
    const openTask = async () => {
      const task =
        projectTasks.find((item) => item.id === notificationTaskId) ||
        (await loadTaskById(notificationTaskId));
      if (!task || task.projectId !== projectId) return;
      if (useKanbanStore.getState().selectedTaskId === notificationTaskId) return;
      setSelectedTask(notificationTaskId);
    };
    void openTask();
  }, [loadTaskById, notificationTaskId, projectId, projectTasks, setSelectedTask]);

  // Clear any stale modal state when the user leaves this project page so the
  // back button restores the project view without a stuck modal.
  useEffect(() => {
    return () => {
      setSelectedTask(null);
    };
  }, [projectId, setSelectedTask]);
  const visibleTasks = getFilteredTasks();
  const completedTasks = projectTasks.filter((t) => t.status === 'done').length;
  const totalEstimate = projectTasks.reduce((sum, t) => sum + t.estimate, 0);
  const totalActual = projectTasks.reduce((sum, t) => sum + t.actualTime, 0);
  const activeTasks = projectTasks.filter((task) => task.status !== 'done');
  const overdueTasks = activeTasks.filter(
    (task) => task.dueDate && new Date(task.dueDate) < new Date(),
  ).length;
  const unassignedTasks = activeTasks.filter((task) => !task.assigneeId).length;

  useEffect(() => {
    if (!membersOpen || !currentProject) return;
    void fetchProjectMembers(currentProject.id)
      .then((result) =>
        setMemberIds(
          (Array.isArray(result) ? result : []).map((item: any) =>
            String(item.USER_ID || item.userId || item),
          ),
        ),
      )
      .catch(() => setMemberIds([]));
  }, [currentProject, membersOpen]);

  async function addMember(userId: string) {
    if (!currentProject) return;
    await addProjectMember(currentProject.id, userId);
    setMemberIds((ids) => [...ids, userId]);
    await useKanbanStore.getState().loadProjects(true);
  }

  async function removeMember(userId: string) {
    if (!currentProject || !window.confirm('Удалить участника из проекта?')) return;
    await removeProjectMember(currentProject.id, userId);
    setMemberIds((ids) => ids.filter((id) => id !== userId));
    await useKanbanStore.getState().loadProjects(true);
  }

  async function saveProject() {
    if (!currentProject || !name.trim()) return;
    await updateProject(currentProject.id, { name: name.trim(), description });
    setSettingsOpen(false);
  }

  async function toggleArchive() {
    if (
      !currentProject ||
      !window.confirm(
        currentProject.isArchived ? 'Вернуть проект из архива?' : 'Архивировать проект?',
      )
    )
      return;
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
    <div className="min-h-screen overflow-x-clip bg-background" suppressHydrationWarning>
      {/* Project Header */}
      <div className="border-b bg-background">
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
                  <span className="rounded border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Архив
                  </span>
                )}
              </h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => setMembersOpen(true)}
                  className="h-auto gap-1 p-0 text-muted-foreground no-underline hover:text-foreground"
                >
                  <Users size={14} />
                  {currentProject.membersCount || 0} участников
                </Button>
                <span>Задач: {projectTasks.length}</span>
                <span className="text-emerald-600">Завершено: {completedTasks}</span>
              </div>
              {(overdueTasks || unassignedTasks) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {overdueTasks > 0 && (
                    <span className="font-medium text-destructive">{overdueTasks} просрочено</span>
                  )}
                  {unassignedTasks > 0 && (
                    <span>
                      {overdueTasks ? ', ' : ''}
                      {unassignedTasks} без исполнителя
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-4">
              <div className="hidden gap-4 text-sm md:flex">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">План</p>
                  <p className="font-semibold">{totalEstimate.toFixed(1)} ч</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Факт</p>
                  <p className="font-semibold">{totalActual.toFixed(1)} ч</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Настройки проекта"
                aria-label="Настройки проекта"
                onClick={() => {
                  setName(currentProject.name);
                  setDescription(currentProject.description);
                  setSettingsOpen(true);
                }}
              >
                <Settings className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Участники проекта</DialogTitle>
          </DialogHeader>
          <Select onValueChange={(value) => void addMember(value)}>
            <SelectTrigger>
              <UserPlus className="size-4" />
              <SelectValue placeholder="Добавить участника" />
            </SelectTrigger>
            <SelectContent>
              {users
                .filter((user) => !memberIds.includes(user.id))
                .map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {memberIds.map((id) => {
              const user = users.find((item) => item.id === id);
              return (
                <div
                  key={id}
                  className="flex items-center justify-between rounded-md px-2 py-2 text-sm"
                >
                  <span>{user?.name || `Пользователь #${id}`}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Удалить участника"
                    onClick={() => void removeMember(id)}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Настройки проекта</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Название"
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Описание"
          />
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => void toggleArchive()}>
              {currentProject.isArchived ? 'Разархивировать' : 'Архивировать'}
            </Button>
            <Button onClick={() => void saveProject()} disabled={!name.trim()}>
              Сохранить
            </Button>
          </DialogFooter>
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
                Список
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
                  Список
                </TabsTrigger>
              </TabsList>
            }
          />
        </TabsContent>
        <TabsContent value="grid" className="mt-0">
          <TaskGrid
            tasks={visibleTasks}
            initialGroupBy="stage"
            initialStatus={initialStatus}
            layoutScope="projects"
            title={null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

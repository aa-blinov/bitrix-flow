'use client';
import { convertBxTask, useKanbanStore } from '@/store/kanban';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { filterQueryParams } from '@/lib/task-filters';
import TaskGrid, { type TaskGridPageQuery } from '@/components/TaskGrid';
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
  // У задач без проекта нет ни доски, ни стадий, поэтому только список.
  const effectiveView = projectId === NO_PROJECT_ID ? 'grid' : view;
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
  // Задачи вне проектов Bitrix никуда не показывает, а их 69 штук. Даём им
  // собственную страницу с тем же списком: настоящего проекта с id 0 нет,
  // поэтому подставляем псевдо-проект.
  const isNoProject = projectId === NO_PROJECT_ID;
  const currentProject = isNoProject
    ? ({
        id: NO_PROJECT_ID,
        name: NO_PROJECT_NAME,
        description: 'Задачи, не привязанные ни к одному проекту',
        membersCount: 0,
        isArchived: false,
      } as (typeof projects)[number])
    : projects.find((p) => p.id === projectId);
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
  const loadGridPage = useCallback(
    async (request: TaskGridPageQuery) => {
      const params = new URLSearchParams({
        ...filterQueryParams(request.filters),
        page: String(request.page),
        limit: String(request.limit),
        query: request.query,
        projectId,
        sorts: request.sorts.map((sort) => `${sort.key}:${sort.direction}`).join(','),
      });
      const response = await fetch(`/api/tasks/all?${params.toString()}`);
      if (!response.ok) throw new Error(`tasks/all HTTP ${response.status}`);
      const data = await response.json();
      return {
        tasks: (Array.isArray(data.tasks) ? data.tasks : []).map(convertBxTask),
        total: Number(data.total) || 0,
      };
    },
    [projectId],
  );
  // Счётчики считает сервер по всему проекту: доска и список грузят только
  // свою страницу, а выбирать ради шапки все задачи из Битрикса — вторая
  // загрузка тех же данных.
  const [stats, setStats] = useState({
    total: 0,
    done: 0,
    overdue: 0,
    unassigned: 0,
    estimateHours: 0,
    actualHours: 0,
  });
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void fetch(`/api/tasks/stats?projectId=${encodeURIComponent(projectId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data && typeof data.total === 'number') setStats(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const completedTasks = stats.done;
  const totalEstimate = stats.estimateHours;
  const totalActual = stats.actualHours;
  const overdueTasks = stats.overdue;
  const unassignedTasks = stats.unassigned;

  useEffect(() => {
    if (!membersOpen || !currentProject) return;
    void fetchProjectMembers(currentProject.id)
      .then((result) =>
        setMemberIds(
          (Array.isArray(result) ? result : []).map((item: unknown) => {
            if (item && typeof item === 'object') {
              const value = item as Record<string, unknown>;
              return String(value.USER_ID ?? value.userId ?? '');
            }
            return String(item);
          }),
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
                <span>Задач: {stats.total}</span>
                <span className="text-emerald-600">Завершено: {completedTasks}</span>
              </div>
              {Boolean(overdueTasks || unassignedTasks) && (
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
              {/* У псевдо-проекта нечего настраивать: это не сущность Bitrix */}
              <Button
                variant="ghost"
                size="icon-sm"
                title="Настройки проекта"
                aria-label="Настройки проекта"
                className={isNoProject ? 'hidden' : undefined}
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

      <Tabs value={effectiveView} onValueChange={setView} className="w-full min-w-0 pb-6">
        <TabsContent value="kanban" className="mt-0 w-full min-w-0">
          <KanbanBoard
            toolbar={
              <TabsList className="h-8 p-0">
                <TabsTrigger value="kanban" className="h-full">
                  <Columns3 className="size-4" />
                  Канбан
                </TabsTrigger>
                <TabsTrigger value="grid" className="h-full">
                  <TableProperties className="size-4" />
                  Список
                </TabsTrigger>
              </TabsList>
            }
          />
        </TabsContent>
        <TabsContent value="grid" className="mt-0 w-full min-w-0">
          <TaskGrid
            initialGroupBy="stage"
            initialStatus={initialStatus}
            layoutScope="projects"
            title={null}
            loadPage={loadGridPage}
            tagsProjectId={projectId}
            filterScope={`project:${projectId}`}
            toolbarLeading={
              isNoProject ? null : (
                <TabsList className="h-8 p-0">
                  <TabsTrigger value="kanban" className="h-full">
                    <Columns3 className="size-4" />
                    Канбан
                  </TabsTrigger>
                  <TabsTrigger value="grid" className="h-full">
                    <TableProperties className="size-4" />
                    Список
                  </TabsTrigger>
                </TabsList>
              )
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

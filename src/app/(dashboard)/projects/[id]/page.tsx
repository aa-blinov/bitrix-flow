'use client';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { pluralRu } from '@/lib/utils';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import KanbanBoard from '@/components/KanbanBoard';
import { ChevronRight, FolderKanban, Settings, Users, X } from 'lucide-react';
import { fetchTaskGridPage } from '@/lib/task-grid-page';
import TaskGrid, { type TaskGridPageQuery } from '@/components/TaskGrid';
import { useConfirm } from '@/components/monos/confirm-dialog';
import { Tabs } from '@/components/monos/Tabs';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { IconButton } from '@/components/monos/IconButton';
import { Modal } from '@/components/monos/Modal';
import { SelectField } from '@/components/monos/SelectField';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import LoadingState from '@/components/LoadingState';
import { addProjectMember, fetchProjectMembers, removeProjectMember } from '@/lib/bitrix24';

// Переключатель вида живёт в панели над доской и над списком, поэтому список
// вкладок набора рисуется без панели: содержимое панели — это сам вид.
const VIEW_TABS = [
  { id: 'kanban', label: 'Канбан' },
  { id: 'grid', label: 'Список' },
];

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
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
  } = useKanbanStore(
    useShallow((s) => ({
      projects: s.projects,
      selectedProjectId: s.selectedProjectId,
      setSelectedProject: s.setSelectedProject,
      setSelectedTask: s.setSelectedTask,
      loadTaskById: s.loadTaskById,
      tasks: s.tasks,
      isRehydrated: s.isRehydrated,
      updateProject: s.updateProject,
      users: s.users,
    })),
  );

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
  // У проекта свой заголовок вместо PageHeader — вкладку подписываем здесь.
  useEffect(() => {
    if (currentProject?.name) document.title = `${currentProject.name} — BitrixFlow`;
  }, [currentProject?.name]);

  const loadGridPage = useCallback(
    (request: TaskGridPageQuery) => fetchTaskGridPage(request, { projectId }),
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

  const memberOptions = useMemo(
    () =>
      users
        .filter((user) => !memberIds.includes(user.id))
        .map((user) => ({ value: user.id, label: user.name })),
    [users, memberIds],
  );

  async function addMember(userId: string) {
    if (!currentProject) return;
    await addProjectMember(currentProject.id, userId);
    setMemberIds((ids) => [...ids, userId]);
    await useKanbanStore.getState().loadProjects(true);
  }

  async function removeMember(userId: string) {
    if (!currentProject) return;
    const agreed = await confirm({
      title: 'Удалить участника из проекта?',
      description: 'Он потеряет доступ к задачам проекта в Битрикс24.',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!agreed) return;
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
    if (!currentProject) return;
    const agreed = await confirm({
      title: currentProject.isArchived ? 'Вернуть проект из архива?' : 'Архивировать проект?',
      description: currentProject.isArchived
        ? 'Проект снова появится в активных списках.'
        : 'Проект уедет в архив: он останется доступен, но пропадёт из основных списков.',
      confirmLabel: currentProject.isArchived ? 'Вернуть' : 'Архивировать',
    });
    if (!agreed) return;
    await updateProject(currentProject.id, { archived: !currentProject.isArchived });
    setSettingsOpen(false);
  }

  if (projects.length === 0) {
    return <LoadingState className="min-h-screen" />;
  }

  if (!currentProject) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="text-center">
          <p className="mb-4 text-ink-soft">Проект не найден</p>
          <Button onClick={() => router.push('/')}>На главную</Button>
        </div>
      </div>
    );
  }

  const viewTabs = (
    <Tabs
      items={VIEW_TABS}
      value={effectiveView}
      onChange={setView}
      label="Вид проекта"
      variant="pill"
    />
  );

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas" suppressHydrationWarning>
      {/* Project Header */}
      <div className="border-b border-line bg-canvas">
        <div className="px-4 pt-3 pb-2 lg:px-6">
          <div className="flex items-center gap-1 overflow-x-auto text-xs text-ink-faint scrollbar-hide">
            <Button
              variant="quiet"
              size="sm"
              onClick={() => router.push('/')}
              className="h-auto min-h-0 max-sm:min-h-0 px-0 py-0 text-xs"
            >
              Главная
            </Button>
            <ChevronRight size={12} strokeWidth={1.7} />
            <span className="font-medium text-ink">{currentProject.name}</span>
          </div>
        </div>

        <div className="px-4 pb-4 lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
                <span className="rounded-ui bg-accent/10 p-2 text-accent">
                  <FolderKanban size={20} strokeWidth={1.7} />
                </span>
                {currentProject.name}
                {currentProject.isArchived && <Badge tone="neutral">Архив</Badge>}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setMembersOpen(true)}
                  className="h-auto min-h-0 max-sm:min-h-0 gap-1 px-0 py-0 text-sm"
                  icon={<Users size={14} strokeWidth={1.7} />}
                >
                  {currentProject.membersCount || 0}{' '}
                  {pluralRu(currentProject.membersCount || 0, [
                    'участник',
                    'участника',
                    'участников',
                  ])}
                </Button>
                <span>Задач: {stats.total}</span>
                <span className="text-success-text">Завершено: {completedTasks}</span>
                {/* Сигналы — в той же строке, что и счётчики: отдельной строкой
                    мелким шрифтом просрочка читалась как сноска. */}
                {overdueTasks > 0 && (
                  <span className="font-medium text-danger-text">Просрочено: {overdueTasks}</span>
                )}
                {unassignedTasks > 0 && <span>Без исполнителя: {unassignedTasks}</span>}
              </div>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-4">
              <div className="hidden gap-4 text-sm md:flex">
                <div className="text-center">
                  <p className="text-xs text-ink-faint">План</p>
                  <p className="font-bold">{totalEstimate.toFixed(1)} ч</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-ink-faint">Факт</p>
                  <p className="font-bold">{totalActual.toFixed(1)} ч</p>
                </div>
              </div>
              {/* У псевдо-проекта нечего настраивать: это не сущность Bitrix */}
              <IconButton
                label="Настройки проекта"
                variant="ghost"
                size="md"
                className={isNoProject ? 'hidden' : undefined}
                onClick={() => {
                  setName(currentProject.name);
                  setDescription(currentProject.description);
                  setSettingsOpen(true);
                }}
              >
                <Settings className="size-4" strokeWidth={1.7} />
              </IconButton>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        title="Участники проекта"
        size="md"
      >
        <SelectField
          value=""
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            void addMember(value);
          }}
          options={memberOptions}
          placeholder="Добавить участника"
          variant="boxed"
          size="md"
          aria-label="Добавить участника"
        />
        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
          {memberIds.map((id) => {
            const user = users.find((item) => item.id === id);
            return (
              <div
                key={id}
                className="flex items-center justify-between rounded-ui px-2 py-2 text-sm"
              >
                <span>{user?.name || `Пользователь #${id}`}</span>
                <IconButton
                  label="Удалить участника"
                  variant="ghost"
                  size="sm"
                  onClick={() => void removeMember(id)}
                >
                  <X className="size-4" strokeWidth={1.7} />
                </IconButton>
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Настройки проекта"
        size="md"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => void toggleArchive()}>
              {currentProject.isArchived ? 'Разархивировать' : 'Архивировать'}
            </Button>
            <Button onClick={() => void saveProject()} disabled={!name.trim()}>
              Сохранить
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <TextField
            label="Название"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Название проекта"
          />
          <TextArea
            label="Описание"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Описание"
          />
        </div>
      </Modal>

      <div className="w-full min-w-0 pb-6">
        {effectiveView === 'kanban' ? (
          <KanbanBoard toolbar={viewTabs} />
        ) : (
          <TaskGrid
            initialGroupBy="stage"
            initialStatus={initialStatus}
            layoutScope="projects"
            title={null}
            loadPage={loadGridPage}
            tagsProjectId={projectId}
            filterScope={`project:${projectId}`}
            toolbarLeading={isNoProject ? null : viewTabs}
          />
        )}
      </div>
    </div>
  );
}

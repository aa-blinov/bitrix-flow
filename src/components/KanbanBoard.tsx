'use client';
import { useKanbanStore } from '@/store/kanban';
import { PRIORITY_LABELS, BxTask, Bx24User } from '@/types/bitrix';
import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import TaskModal from './TaskModal';
import {
  Plus,
  Filter,
  X,
  Users,
  Calendar,
  Timer,
  Eye,
  Clock,
  AlignLeft,
  Paperclip,
  MessageSquare,
  ChevronDown,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import LoadingState from '@/components/LoadingState';
import { sortKanbanTasks, type KanbanSort } from '@/lib/kanban-sort';

function getStageColor(hex: string): { bg: string; text: string; border: string } {
  // ponytail: используем opacity-варианты (bg-X-500/15) — одинаково
  // читаются и в светлой, и в тёмной теме без dark: префикса.
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    '47d1e2': { bg: 'bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-500/30' },
    '75d900': { bg: 'bg-green-500/15', text: 'text-green-700 dark:text-green-300', border: 'border-green-500/30' },
    ffab00: { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-500/30' },
    ff5752: { bg: 'bg-red-500/15', text: 'text-red-700 dark:text-red-300', border: 'border-red-500/30' },
    '1eae43': { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-500/30' },
  };
  return (
    colors[hex?.toLowerCase()] || {
      bg: 'bg-muted',
      text: 'text-muted-foreground',
      border: 'border-border',
    }
  );
}

function getStageDotColor(hex: string): string {
  const colors: Record<string, string> = {
    '47d1e2': 'bg-cyan-500',
    '75d900': 'bg-green-500',
    ffab00: 'bg-amber-500',
    ff5752: 'bg-red-500',
    '1eae43': 'bg-emerald-500',
  };
  return colors[hex?.toLowerCase()] || 'bg-gray-400';
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-rose-500',
    'bg-pink-500',
    'bg-fuchsia-500',
    'bg-purple-500',
    'bg-violet-500',
    'bg-indigo-500',
    'bg-blue-500',
    'bg-sky-500',
    'bg-cyan-500',
    'bg-teal-500',
    'bg-emerald-500',
    'bg-green-500',
    'bg-lime-500',
    'bg-yellow-500',
    'bg-amber-500',
    'bg-orange-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Завтра';
    if (diff === -1) return 'Вчера';
    if (diff > 1 && diff < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
    if (diff < 0 && diff > -7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
    return d.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function KanbanBoard({ toolbar }: { toolbar?: ReactNode }) {
  const {
    tasks,
    stages,
    selectedProjectId,
    moveTaskToStage,
    setSelectedTask,
    createTask,
    createStage,
    isLoading,
    filters,
    setFilters,
    users,
    getFilteredTasks,
    projects,
    currentUser,
  } = useKanbanStore();

  const [kanbanSort, setKanbanSort] = useState<KanbanSort>('urgency');
  const filteredTasks = useMemo(() => sortKanbanTasks(getFilteredTasks(), kanbanSort), [filters, getFilteredTasks, kanbanSort, selectedProjectId, tasks]);

  // Добавляем дефолтные системные стадии
  const defaultStages = [
    { id: '0', name: 'New', color: '47d1e2', sort: 0, systemType: 'NEW', entityId: '' },
    {
      id: 'in_progress',
      name: 'In Progress',
      color: '75d900',
      sort: 200,
      systemType: 'PROCESS',
      entityId: '',
    },
    { id: 'done', name: 'Done', color: 'ff5752', sort: 999, systemType: 'SUCCESS', entityId: '' },
  ];
  // Project stages from Bitrix24 are authoritative. The generic columns are
  // only a fallback for projects that do not have task stages configured.
  const allStages = (stages.length > 0 ? stages : defaultStages)
    .slice()
    .sort((a, b) => a.sort - b.sort);
  const newStageId = allStages.find((stage) => stage.systemType === 'NEW')?.id;
  // Older Bitrix tasks may retain stage "0" after a project switches to
  // custom stages. Render them in the project's system "New" phase instead
  // of dropping them from the board.
  const displayedStageId = (task: BxTask) =>
    task.stageId === '0' && newStageId ? newStageId : task.stageId;

  // Tasks whose stageId does not match any known stage (deleted stage,
  // permissions error on task.stages.get, project Kanban disabled, …) get
  // rendered in a dedicated fallback column so they are never silently lost.
  const knownStageIds = new Set(allStages.map((stage) => stage.id));
  const orphanTasks = filteredTasks.filter(
    (task) => !knownStageIds.has(displayedStageId(task)),
  );
  if (orphanTasks.length > 0 && process.env.NODE_ENV !== 'production') {
    // ponytail: dev-only — silent in prod, noisy when something is misconfigured.
    console.warn(
      `[kanban] ${orphanTasks.length} задач(а) вне известных стадий — проверь task.stages.get`,
    );
  }

  const [showFilters, setShowFilters] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    responsibleId: '',
    priority: 'medium',
    deadline: '',
    estimate: '',
    stageId: '',
  });
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<string>(stages[0]?.id || 'new');
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // Inline "+ задача" в колонке: stageId открытой формы. null = нигде не открыта.
  const [inlineAddStage, setInlineAddStage] = useState<string | null>(null);
  const [showStageDialog, setShowStageDialog] = useState(false);
  const [stageName, setStageName] = useState('');
  const [isCreatingStage, setIsCreatingStage] = useState(false);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);

  const selectedTask = useKanbanStore((s) =>
    s.selectedTaskId ? s.tasks.find((task) => task.id === s.selectedTaskId) || s.allTasks.find((task) => task.id === s.selectedTaskId) || null : null,
  );
  const currentProject = projects.find((p) => p.id === selectedProjectId);
  const avatarByUserId = new Map(users.map((user) => [user.id, user.icon]));

  useEffect(() => {
    if (stages.length > 0 && !stages.find((s) => s.id === activeColumn)) {
      setActiveColumn(stages[0].id);
    }
  }, [stages]);

  if (!selectedProjectId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Search className="text-muted-foreground" size={28} />
          </div>
          <h2 className="mb-2 text-xl font-medium text-foreground">Проект не выбран</h2>
          <p className="text-sm text-muted-foreground">
            Выберите проект в боковой панели, чтобы увидеть задачи
          </p>
        </div>
      </div>
    );
  }

  const activeFiltersCount = [
    filters.assigneeId,
    filters.priority,
    filters.hasDeadline,
    filters.overdue,
    !filters.showCompleted,
  ].filter(Boolean).length;

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTask(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleDragOver = (e: React.DragEvent, columnId?: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (columnId) setDragOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    if (draggedTask) {
      moveTaskToStage(draggedTask, stageId);
      setDraggedTask(null);
      setDragOverColumn(null);
    }
  };

  const handleAddTask = async () => {
    if (newTask.title.trim()) {
      const created = await createTask({
        title: newTask.title.trim(),
        description: newTask.description.trim(),
        responsibleId: newTask.responsibleId,
        priority: newTask.priority,
        deadline: newTask.deadline ? new Date(newTask.deadline).toISOString() : undefined,
        estimate: newTask.estimate ? Number(newTask.estimate) : undefined,
        stageId: newTask.stageId || undefined,
      });
      if (created) {
        setNewTask({
          title: '',
          description: '',
          responsibleId: currentUser.id || users[0]?.id || '',
          priority: 'medium',
          deadline: '',
          estimate: '',
          stageId: '',
        });
        setShowAddModal(false);
      }
    }
  };

  // Inline-add: создать задачу прямо в указанной колонке. Не показывает
  // модалку, форма появляется прямо в колонке. После успеха возвращает true,
  // чтобы InlineAddForm очистил input и остался открытым (для batch-добавления).
  const handleInlineAdd = async (
    stageId: string,
    data: { title: string; assigneeId: string; priority: string },
  ): Promise<boolean> => {
    const created = await createTask({
      title: data.title,
      responsibleId: data.assigneeId || currentUser.id || users[0]?.id || '',
      priority: data.priority,
      stageId,
    });
    return !!created;
  };

  const openAddDialog = () => {
    setNewTask({
      title: '',
      description: '',
      responsibleId: currentUser.id || users[0]?.id || '',
      priority: 'medium',
      deadline: '',
      estimate: '',
      stageId: '',
    });
    setShowAddModal(true);
  };

  const handleCreateStage = async () => {
    setIsCreatingStage(true);
    if (await createStage(stageName)) {
      setStageName('');
      setShowStageDialog(false);
    }
    setIsCreatingStage(false);
  };

  if (isLoading && tasks.length === 0) {
    return <LoadingState className="min-h-[60vh] flex-1" />;
  }

  return (
    <div className="flex min-w-0 flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 overflow-hidden border-b bg-background px-4 py-4 lg:px-6">
        <div className="flex w-full min-w-0 items-center gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide">
          {toolbar}
          <Select value={kanbanSort} onValueChange={(value) => setKanbanSort(value as KanbanSort)}>
            <SelectTrigger className="h-8 w-36 shrink-0 bg-background" aria-label="Сортировка задач"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="urgency">По срочности</SelectItem>
              <SelectItem value="updated">По обновлению</SelectItem>
              <SelectItem value="deadline">По дедлайну</SelectItem>
              <SelectItem value="title">По названию</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={filters.search}
            onChange={(event) => setFilters({ search: event.target.value })}
            placeholder="Поиск задач…"
            className="h-8 w-48 shrink-0 bg-background"
            aria-label="Поиск задач на доске"
          />
          <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
            <Button
              variant={showFilters || activeFiltersCount > 0 ? 'default' : 'outline'}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={14} />
            <span>Фильтр</span>
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 bg-background/20 text-inherit">
                {activeFiltersCount}
              </Badge>
            )}
          </Button>

            <Button variant="outline" onClick={() => setShowStageDialog(true)}>
              <Plus size={14} />
              <span>Фаза</span>
            </Button>

            <Button onClick={openAddDialog}>
              <Plus size={14} />
              <span>Добавить задачу</span>
            </Button>
          </div>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-3 animate-slideUp rounded-lg border bg-muted/50 p-3">
            <div className="flex flex-wrap gap-2">
              <Select
                value={filters.assigneeId}
                onValueChange={(value) => setFilters({ assigneeId: value === 'all' ? '' : value })}
              >
                <SelectTrigger className="min-w-40">
                  <SelectValue placeholder="Все исполнители" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все исполнители</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant={filters.priority === 'high' ? 'secondary' : 'outline'}
                onClick={() => setFilters({ priority: filters.priority === 'high' ? '' : 'high' })}
              >
                Высокий приоритет
              </Button>

              <Button
                variant={filters.overdue ? 'destructive' : 'outline'}
                onClick={() => setFilters({ overdue: !filters.overdue })}
              >
                Просрочено
              </Button>

              <Button
                variant={filters.hasDeadline ? 'secondary' : 'outline'}
                onClick={() => setFilters({ hasDeadline: !filters.hasDeadline })}
              >
                С дедлайном
              </Button>

              <Button
                variant={!filters.showCompleted ? 'secondary' : 'outline'}
                onClick={() => setFilters({ showCompleted: !filters.showCompleted })}
              >
                {filters.showCompleted ? 'Скрыть завершённые' : 'Показать завершённые'}
              </Button>

              {activeFiltersCount > 0 && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setFilters({
                      search: '',
                      assigneeId: '',
                      hasDeadline: false,
                      overdue: false,
                      showCompleted: true,
                    })
                  }
                >
                  Сбросить
                </Button>
              )}
            </div>
          </div>
        )}
      </header>

      <Dialog open={showStageDialog} onOpenChange={setShowStageDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новая фаза</DialogTitle>
          </DialogHeader>
          <Input
            value={stageName}
            onChange={(event) => setStageName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void handleCreateStage()}
            placeholder="Например, На согласовании"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStageDialog(false)}>
              Отмена
            </Button>
            <Button onClick={() => void handleCreateStage()} disabled={!stageName.trim() || isCreatingStage}>
              {isCreatingStage ? 'Создаём…' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Columns already scroll horizontally on small screens; a second stage
          navigation row duplicated them and made labels overlap. */}
      <div className="hidden">
        <div className="flex overflow-x-auto scrollbar-hide">
          {allStages.map((stage: any) => {
            const count = filteredTasks.filter((t) => t.stageId === stage.id).length;
            return (
              <Button
                key={stage.id}
                onClick={() => setActiveColumn(stage.id)}
                variant="ghost"
                className={`h-auto min-w-[120px] flex-1 rounded-none border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap ${
                  activeColumn === stage.id
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${getStageDotColor(stage.color)}`} />
                  <span>{stage.name}</span>
                  <span className="text-xs text-muted-foreground">{count}</span>
                </div>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Верхний scrollbar — только desktop; синхронизирован с доской ниже. */}
      <div
        ref={topScrollRef}
        onScroll={(event) => {
          if (boardScrollRef.current) boardScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        className="hidden overflow-x-auto border-b bg-background lg:block"
      >
        <div className="flex min-w-max gap-4 px-4 py-2 xl:gap-5">
          {allStages.map((stage) => <div key={stage.id} className="h-px w-[14rem] xl:w-[15rem]" />)}
          {orphanTasks.length > 0 && <div className="h-px w-[14rem] xl:w-[15rem]" />}
        </div>
      </div>

      {/* Board */}
      <div
        ref={boardScrollRef}
        onScroll={(event) => {
          if (topScrollRef.current) topScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        className="flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-background scrollbar-hide lg:snap-none"
      >
        <div className="flex h-full min-w-max gap-3 px-4 py-4 xl:gap-4">
          {allStages.map((stage: any) => {
            const colTasks = filteredTasks.filter((task) => displayedStageId(task) === stage.id);
            const colors = getStageColor(stage.color);
            const isDragOver = dragOverColumn === stage.id;

            return (
              <Card
                key={stage.id}
                className={`w-[20rem] shrink-0 snap-start gap-0 rounded-lg bg-muted/30 py-0 shadow-none ring-0 transition-colors lg:w-[14rem] lg:snap-none xl:w-[15rem] ${
                  isDragOver ? 'ring-2 ring-blue-400 bg-blue-500/10' : ''
                }`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 border-b px-3 py-2.5">
                  <div className={`w-2 h-2 rounded-full ${getStageDotColor(stage.color)}`} />
                  <h3 className="flex-1 text-sm font-semibold text-foreground">{stage.name}</h3>
                  <span className="text-xs font-medium text-muted-foreground">
                    {colTasks.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    onClick={() => setInlineAddStage(stage.id)}
                    aria-label={`Добавить задачу в фазу ${stage.name}`}
                  >
                    <Plus size={15} />
                  </Button>
                </div>

                {/* Tasks list */}
                <div className="flex-1 p-2 space-y-1.5 overflow-y-auto min-h-[200px]">
                  {colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      avatarUrl={task.assigneeAvatar || avatarByUserId.get(task.assigneeId || '')}
                      onDragStart={handleDragStart}
                      onClick={() => setSelectedTask(task.id)}
                      isDragging={draggedTask === task.id}
                    />
                  ))}

                  {inlineAddStage === stage.id && (
                    <InlineAddForm
                      stageId={stage.id}
                      defaultAssigneeId={currentUser.id}
                      users={users}
                      onSubmit={(data) => handleInlineAdd(stage.id, data)}
                      onCancel={() => setInlineAddStage(null)}
                    />
                  )}
                </div>

              </Card>
            );
          })}

          {orphanTasks.length > 0 && (
            <Card
              className="w-[20rem] flex-shrink-0 gap-0 py-0 border-dashed opacity-80 lg:w-[14rem] xl:w-[15rem]"
              onDragOver={(e) => handleDragOver(e, 'orphan')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => {
                // Drop into fallback column: just keep current stage, but the
                // task is still visible so it can be edited/moved properly.
                e.preventDefault();
                setDraggedTask(null);
                setDragOverColumn(null);
              }}
            >
              <div className="flex items-center gap-2 border-b px-3 py-2.5">
                <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                <h3 className="flex-1 text-sm font-semibold text-foreground">Без фазы</h3>
                <span className="text-xs font-medium text-muted-foreground">
                  {orphanTasks.length}
                </span>
              </div>
              <div className="flex-1 p-2 space-y-1.5 overflow-y-auto min-h-[200px]">
                {orphanTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    avatarUrl={task.assigneeAvatar || avatarByUserId.get(task.assigneeId || '')}
                    onDragStart={handleDragStart}
                    onClick={() => setSelectedTask(task.id)}
                    isDragging={draggedTask === task.id}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Add Task Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              Проект: <span className="font-medium text-foreground">{currentProject?.name}</span>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              Название задачи *
              <Input
                value={newTask.title}
                onChange={(event) =>
                  setNewTask((value) => ({ ...value, title: event.target.value }))
                }
                placeholder="Что нужно сделать"
                autoFocus
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Описание
              <Textarea
                value={newTask.description}
                onChange={(event) =>
                  setNewTask((value) => ({ ...value, description: event.target.value }))
                }
                placeholder="Контекст и ожидаемый результат"
              />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                Исполнитель
                <Select
                  value={newTask.responsibleId || 'unassigned'}
                  onValueChange={(value) =>
                    setNewTask((item) => ({
                      ...item,
                      responsibleId: value === 'unassigned' ? '' : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned" disabled>
                      Выберите исполнителя
                    </SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Приоритет
                <Select
                  value={newTask.priority}
                  onValueChange={(value) => setNewTask((item) => ({ ...item, priority: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Низкий</SelectItem>
                    <SelectItem value="medium">Обычный</SelectItem>
                    <SelectItem value="high">Высокий</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Дедлайн
                <Input
                  type="datetime-local"
                  value={newTask.deadline}
                  onChange={(event) =>
                    setNewTask((item) => ({ ...item, deadline: event.target.value }))
                  }
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Оценка, часы
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={newTask.estimate}
                  onChange={(event) =>
                    setNewTask((item) => ({ ...item, estimate: event.target.value }))
                  }
                  placeholder="Например, 2.5"
                />
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              Фаза
              <Select
                value={newTask.stageId || 'none'}
                onValueChange={(value) =>
                  setNewTask((item) => ({ ...item, stageId: value === 'none' ? '' : value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не выбрана</SelectItem>
                  {allStages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleAddTask}
              disabled={!newTask.title.trim() || !newTask.responsibleId}
            >
              Создать задачу
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}

function InlineAddForm({
  stageId,
  onSubmit,
  onCancel,
  users,
  defaultAssigneeId,
}: {
  stageId: string;
  onSubmit: (data: { title: string; assigneeId: string; priority: string }) => Promise<boolean>;
  onCancel: () => void;
  users: Bx24User[];
  defaultAssigneeId?: string;
}) {
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId || '');
  const [priority, setPriority] = useState('medium');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const ok = await onSubmit({ title: trimmed, assigneeId, priority });
    setSubmitting(false);
    if (ok) {
      setTitle('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="rounded-md border bg-background p-2 shadow-sm">
      <Input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Название задачи…"
        className="h-8 text-sm"
        disabled={submitting}
      />
      <div className="mt-2 flex items-center gap-1">
        <Select value={assigneeId || 'unassigned'} onValueChange={(value) => setAssigneeId(value === 'unassigned' ? '' : value)} disabled={submitting}>
          <SelectTrigger className="h-7 min-w-0 flex-1 text-xs" aria-label="Исполнитель"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Без исполнителя</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="h-7 w-24 text-xs" aria-label="Приоритет"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Низкий</SelectItem>
            <SelectItem value="medium">Обычный</SelectItem>
            <SelectItem value="high">Высокий</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Отмена
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={!title.trim() || submitting}>
          {submitting ? '…' : 'Создать'}
        </Button>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  avatarUrl,
  onDragStart,
  onClick,
  isDragging,
}: {
  task: BxTask;
  avatarUrl?: string;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: () => void;
  isDragging: boolean;
}) {
  const priority = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.medium;
  const isCompleted = task.status === 'done';
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';
  const dueDate = formatDate(task.dueDate);
  const completedSubtasks = task.subtasks?.filter((s) => s.status === 'done').length || 0;
  const totalSubtasks = task.subtasks?.length || 0;

  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={onClick}
      className={`cursor-pointer gap-0 rounded-lg border border-transparent bg-background p-3 shadow-none ring-0 transition-colors hover:border-border hover:shadow-sm ${
        isDragging ? 'opacity-40 rotate-1' : isCompleted ? 'bg-muted/60 text-muted-foreground' : ''
      }`}
    >
      {/* Tags row */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {task.priority !== 'medium' && task.priority !== 'low' && (
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide ${priority.bgColor} ${priority.color}`}
          >
            {priority.label}
          </span>
        )}
        {task.parentId && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
            Подзадача
          </span>
        )}
      </div>

      {/* Title */}
      <h4
        className={`mb-2 text-sm leading-snug line-clamp-2 xl:line-clamp-3 ${
          isCompleted ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
      >
        {task.title}
      </h4>

      {/* Description indicator */}
      {task.description && (
        <div className="text-muted-foreground mb-2">
          <AlignLeft size={14} />
        </div>
      )}

      {/* Meta footer */}
      <div className="mt-2 flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-3 text-xs text-muted-foreground min-w-0 flex-1">
          {dueDate && (
            <span
              className={`flex items-center gap-1 shrink-0 ${isOverdue ? 'text-destructive font-medium' : ''}`}
            >
              <Calendar size={12} />
              {dueDate}
            </span>
          )}
          {task.actualTime > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              <Timer size={12} />
              {task.actualTime} ч
            </span>
          )}
          {totalSubtasks > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              <span>☐</span>
              {completedSubtasks}/{totalSubtasks}
            </span>
          )}
        </div>

        {task.assigneeName && (
          avatarUrl ? (
            <img
              src={avatarUrl}
              alt={task.assigneeName}
              title={task.assigneeName}
              className="size-6 shrink-0 rounded-full object-cover ring-2 ring-card"
            />
          ) : (
            <div
              className={`w-6 h-6 rounded-full ${getAvatarColor(task.assigneeName)} text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-card shrink-0`}
              title={task.assigneeName}
            >
              {getInitials(task.assigneeName)}
            </div>
          )
        )}
      </div>
    </Card>
  );
}

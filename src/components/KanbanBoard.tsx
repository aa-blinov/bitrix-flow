'use client';
import { useKanbanStore } from '@/store/kanban';
import { PRIORITY_LABELS, BxTask } from '@/types/bitrix';
import { useState, useEffect, useRef } from 'react';
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
  MoreHorizontal,
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

function getStageColor(hex: string): { bg: string; text: string; border: string } {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    '47d1e2': { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
    '75d900': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
    ffab00: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    ff5752: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
    '1eae43': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  };
  return (
    colors[hex?.toLowerCase()] || {
      bg: 'bg-gray-50',
      text: 'text-gray-700',
      border: 'border-gray-200',
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
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return d.toLocaleDateString('en', { weekday: 'short' });
    if (diff < 0 && diff > -7) return d.toLocaleDateString('en', { weekday: 'short' });
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function KanbanBoard() {
  const {
    tasks,
    stages,
    selectedProjectId,
    moveTaskToStage,
    setSelectedTask,
    createTask,
    isLoading,
    filters,
    setFilters,
    users,
    getFilteredTasks,
    projects,
    currentUser,
  } = useKanbanStore();

  const filteredTasks = getFilteredTasks();

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

  const selectedTask = useKanbanStore((s) =>
    s.selectedTaskId ? tasks.find((t) => t.id === s.selectedTaskId) : null,
  );
  const currentProject = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    if (stages.length > 0 && !stages.find((s) => s.id === activeColumn)) {
      setActiveColumn(stages[0].id);
    }
  }, [stages]);

  if (!selectedProjectId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-white">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-50">
            <Search className="text-gray-300" size={28} />
          </div>
          <h2 className="mb-2 text-xl font-medium text-gray-900">No project selected</h2>
          <p className="text-sm text-gray-500">
            Select a project from the sidebar to start viewing tasks
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
    filters.showCompleted,
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

  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-white">
      {/* Header */}
      <header className="px-6 py-4 border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="flex items-center justify-end gap-2">
          <Button
            variant={showFilters || activeFiltersCount > 0 ? 'default' : 'outline'}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={14} />
            <span>Filter</span>
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 bg-background/20 text-inherit">
                {activeFiltersCount}
              </Badge>
            )}
          </Button>

          <Button onClick={openAddDialog}>
            <Plus size={14} />
            <span>Add task</span>
          </Button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 animate-slideUp">
            <div className="flex flex-wrap gap-2">
              <Select
                value={filters.assigneeId}
                onValueChange={(value) => setFilters({ assigneeId: value === 'all' ? '' : value })}
              >
                <SelectTrigger className="min-w-40">
                  <SelectValue placeholder="All assignees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assignees</SelectItem>
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
                High priority
              </Button>

              <Button
                variant={filters.overdue ? 'destructive' : 'outline'}
                onClick={() => setFilters({ overdue: !filters.overdue })}
              >
                Overdue
              </Button>

              <Button
                variant={filters.hasDeadline ? 'secondary' : 'outline'}
                onClick={() => setFilters({ hasDeadline: !filters.hasDeadline })}
              >
                Has deadline
              </Button>

              {activeFiltersCount > 0 && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setFilters({
                      assigneeId: '',
                      priority: '',
                      hasDeadline: false,
                      overdue: false,
                      showCompleted: filters.showCompleted,
                    })
                  }
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        )}
      </header>

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
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${getStageDotColor(stage.color)}`} />
                  <span>{stage.name}</span>
                  <span className="text-xs text-gray-400">{count}</span>
                </div>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto bg-gray-50">
        <div className="flex gap-3 p-6 min-w-max h-full">
          {allStages.map((stage: any) => {
            const colTasks = filteredTasks.filter((t) => t.stageId === stage.id);
            const colors = getStageColor(stage.color);
            const isDragOver = dragOverColumn === stage.id;

            return (
              <Card
                key={stage.id}
                className={`w-72 flex-shrink-0 gap-0 py-0 transition-colors ${
                  isDragOver ? 'border-blue-400 bg-blue-50/30' : 'border-gray-200'
                }`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {/* Column header */}
                <div className="px-3 py-2.5 flex items-center gap-2 border-b border-gray-100">
                  <div className={`w-2 h-2 rounded-full ${getStageDotColor(stage.color)}`} />
                  <h3 className="text-sm font-semibold text-gray-700 flex-1">{stage.name}</h3>
                  <span className="text-xs text-gray-500 font-medium">{colTasks.length}</span>
                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
                    <MoreHorizontal size={14} />
                  </Button>
                </div>

                {/* Tasks list */}
                <div className="flex-1 p-2 space-y-1.5 overflow-y-auto min-h-[200px]">
                  {colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onDragStart={handleDragStart}
                      onClick={() => setSelectedTask(task.id)}
                      isDragging={draggedTask === task.id}
                    />
                  ))}

                  {colTasks.length === 0 && !isLoading && (
                    <Button
                      onClick={openAddDialog}
                      variant="outline"
                      className="h-auto w-full border-2 border-dashed py-6 text-muted-foreground"
                    >
                      <Plus size={14} />
                      Add task
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
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

function TaskCard({
  task,
  onDragStart,
  onClick,
  isDragging,
}: {
  task: BxTask;
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
      className={`cursor-pointer gap-0 p-3 transition-all hover:ring-primary/20 hover:shadow-sm ${
        isDragging ? 'opacity-40 rotate-1' : isCompleted ? 'bg-muted/50 opacity-60 grayscale' : ''
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
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">
            Subtask
          </span>
        )}
      </div>

      {/* Title */}
      <h4
        className={`mb-2 text-sm leading-snug line-clamp-2 ${
          isCompleted ? 'text-muted-foreground line-through' : 'text-gray-900'
        }`}
      >
        {task.title}
      </h4>

      {/* Description indicator */}
      {task.description && (
        <div className="text-gray-400 mb-2">
          <AlignLeft size={14} />
        </div>
      )}

      {/* Meta footer */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {dueDate && (
            <span
              className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}
            >
              <Calendar size={12} />
              {dueDate}
            </span>
          )}
          {task.actualTime > 0 && (
            <span className="flex items-center gap-1">
              <Timer size={12} />
              {task.actualTime}h
            </span>
          )}
          {totalSubtasks > 0 && (
            <span className="flex items-center gap-1">
              <span className="text-gray-400">☐</span>
              {completedSubtasks}/{totalSubtasks}
            </span>
          )}
        </div>

        {task.assigneeName && (
          <div
            className={`w-6 h-6 rounded-full ${getAvatarColor(task.assigneeName)} text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white`}
            title={task.assigneeName}
          >
            {getInitials(task.assigneeName)}
          </div>
        )}
      </div>
    </Card>
  );
}

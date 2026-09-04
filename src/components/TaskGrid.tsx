'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  ExternalLink,
  MoreHorizontal,
  Filter,
  GripVertical,
} from 'lucide-react';
import { BxTask, PRIORITY_LABELS, STATUS_LABELS } from '@/types/bitrix';
import { isDueThisWeek, needsDeadlineAttention } from '@/lib/task-urgency';
import { extractTaskTags } from '@/lib/task-tags';
import { getBitrixTaskUrl } from '@/lib/utils';
import { formatBitrixDateTime } from '@/lib/bitrix-markup';
import { useKanbanStore } from '@/store/kanban';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import TaskModal from './TaskModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const controlClass =
  'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-input focus:border-input focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/30';

// Хук навигации по задаче через URL: каждая открытая задача — это
// /<path>?task=<id>, и back/forward браузера честно меняют состояние. Store
// держит selectedTaskId, и страница /all-tasks зеркалит searchParam в него
// через useEffect — этот хук просто пишет в URL, остальное делает она.
function useTaskUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openTask = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('task', id);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const closeTask = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('task');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  return { openTask, closeTask };
}
const inputDate = (value?: string) => (value ? value.slice(0, 10) : '');
const PAGE_SIZE = 50;
type SortKey =
  | 'title'
  | 'project'
  | 'stage'
  | 'assignee'
  | 'priority'
  | 'deadline'
  | 'estimate'
  | 'actual'
  | 'updated'
  | 'description'
  | 'created'
  | 'comments'
  | 'parent'
  | 'storyPoints'
  | 'tags';
type Sort = { key: SortKey; direction: 'asc' | 'desc' };
type ColumnKey = SortKey;
type GroupBy = 'none' | 'stage' | 'assignee' | 'hierarchy';
const GROUP_BY_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: 'none', label: 'Без группировки' },
  { value: 'stage', label: 'По фазе' },
  { value: 'assignee', label: 'По исполнителю' },
  { value: 'hierarchy', label: 'Иерархия задач' },
];
const isGroupBy = (value: string): value is GroupBy =>
  GROUP_BY_OPTIONS.some((option) => option.value === value);
type SavedView = {
  id: string;
  name: string;
  config: {
    statusFilter: string;
    assigneeFilter: string;
    projectFilter: string;
    groupBy: GroupBy;
    hideDone: boolean;
    sorts: Sort[];
    visibleColumns: ColumnKey[];
    columnWidths?: Record<SortKey, number>;
  };
};
const DEFAULT_COLUMNS: ColumnKey[] = [
  'title',
  'project',
  'stage',
  'assignee',
  'priority',
  'estimate',
  'actual',
  'deadline',
];
function normalizeVisibleColumns(columns: unknown): ColumnKey[] {
  if (!Array.isArray(columns)) return DEFAULT_COLUMNS;
  const valid = columns.filter(
    (column): column is ColumnKey => typeof column === 'string' && column in COLUMN_LABELS,
  );
  const unique = [...new Set(valid)];
  return unique.includes('title') ? unique : ['title', ...unique];
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  title: 'Задача',
  project: 'Проект',
  stage: 'Фаза',
  assignee: 'Исполнитель',
  priority: 'Приоритет',
  deadline: 'Дедлайн',
  estimate: 'План, ч',
  actual: 'Факт, ч',
  description: 'Описание',
  created: 'Создана',
  updated: 'Обновлена',
  comments: 'Комментарии',
  parent: 'Родительская',
  storyPoints: 'Story points',
  tags: 'Теги',
};
const COLUMN_WIDTHS: Record<SortKey, number> = {
  title: 280,
  project: 180,
  stage: 140,
  assignee: 160,
  priority: 130,
  deadline: 140,
  estimate: 150,
  actual: 80,
  updated: 160,
  description: 260,
  created: 160,
  comments: 110,
  parent: 130,
  storyPoints: 120,
  tags: 220,
};

function SortableVisibleColumn({
  column,
  onToggle,
}: {
  column: ColumnKey;
  onToggle: (column: ColumnKey, checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center rounded-md ${isDragging ? 'bg-accent opacity-60' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none px-1 text-muted-foreground active:cursor-grabbing"
        aria-label={`Изменить порядок поля ${COLUMN_LABELS[column]}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <DropdownMenuCheckboxItem
        className="flex-1"
        checked
        disabled={column === 'title'}
        onSelect={(event) => event.preventDefault()}
        onCheckedChange={(checked) => onToggle(column, checked)}
      >
        {COLUMN_LABELS[column]}
      </DropdownMenuCheckboxItem>
    </div>
  );
}

function EditableTitle({
  task,
  tree,
}: {
  task: BxTask;
  tree?: { depth: number; hasChildren: boolean; expanded: boolean; onToggle: () => void };
}) {
  const updateTaskField = useKanbanStore((state) => state.updateTaskField);
  const { openTask } = useTaskUrl();
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);
  const commit = () => {
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title)
      void updateTaskField(task.id, 'title', next).catch(() => setTitle(task.title));
  };
  return (
    <div
      className="flex min-w-0"
      style={{ paddingLeft: tree ? `${tree.depth * 20}px` : undefined }}
    >
      {tree?.hasChildren ? (
        <Button
          variant="ghost"
          size="icon"
          className="mt-1 size-6 shrink-0"
          aria-label={
            tree.expanded
              ? `Свернуть подзадачи ${task.title}`
              : `Развернуть подзадачи ${task.title}`
          }
          onClick={tree.onToggle}
        >
          {tree.expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
      ) : tree?.depth ? (
        <span className="mt-1 block size-6 shrink-0 border-l border-b border-muted-foreground/30" />
      ) : null}
      <div className="min-w-0 flex-1">
        <Input
          aria-label={`Название задачи ${task.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setTitle(task.title);
              event.currentTarget.blur();
            }
          }}
          className="h-8 max-w-full border-transparent bg-transparent px-1 font-medium shadow-none hover:border-input focus-visible:border-input focus-visible:bg-background focus-visible:ring-2"
        />
        <div className="mt-1 flex gap-2 px-1 text-xs text-muted-foreground">
          <a
            href={getBitrixTaskUrl(task.id)}
            target="_blank"
            rel="noreferrer"
            className="hover:text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            #{task.id}
          </a>
          {task.parentId && (
            <button
              type="button"
              className="hover:text-foreground hover:underline"
              onClick={() => openTask(task.parentId!)}
            >
              ↳ Подзадача #{task.parentId}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineSelect({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="max-w-full truncate rounded px-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {label}
      </button>
    );
  }
  return (
    <Select
      value={value}
      open
      onOpenChange={setOpen}
      onValueChange={(next) => {
        onChange(next);
        setOpen(false);
      }}
    >
      <SelectTrigger className="h-8 w-full min-w-0" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TaskTags({ task }: { task: BxTask }) {
  const tags = extractTaskTags(task.title, task.description);
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-[10px]">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function FieldControls({
  task,
  compact = false,
  readOnly = false,
  visibleColumns = DEFAULT_COLUMNS,
}: {
  task: BxTask;
  compact?: boolean;
  readOnly?: boolean;
  visibleColumns?: ColumnKey[];
}) {
  const { users, stages, updateTaskField, moveTaskToStage } = useKanbanStore();
  const label = (name: string, child: React.ReactNode) => (
    <label className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 text-xs text-muted-foreground">
      <span>{name}</span>
      {child}
    </label>
  );
  const stageOptions = stages.length
    ? stages
    : [{ id: task.stageId, name: task.status === 'done' ? 'Завершена' : 'Без фазы' }];
  const phase = (
    <InlineSelect
      label={stageOptions.find((stage) => stage.id === task.stageId)?.name || 'Без фазы'}
      value={task.stageId}
      options={stageOptions.map((stage) => ({ value: stage.id, label: stage.name }))}
      onChange={(value) => void moveTaskToStage(task.id, value)}
      ariaLabel="Фаза"
    />
  );
  const assigneeOptions = [
    { value: 'unassigned', label: 'Не назначен' },
    ...users.map((user) => ({ value: user.id, label: user.name })),
  ];
  const assignee = (
    <InlineSelect
      label={task.assigneeName || 'Не назначен'}
      value={task.assigneeId || 'unassigned'}
      options={assigneeOptions}
      onChange={(value) =>
        void updateTaskField(task.id, 'assigneeId', value === 'unassigned' ? '' : value)
      }
      ariaLabel="Исполнитель"
    />
  );
  const priorityOptions = Object.entries(PRIORITY_LABELS)
    .filter(([key]) => key !== 'critical')
    .map(([value, item]) => ({ value, label: item.label }));
  const priority = (
    <InlineSelect
      label={PRIORITY_LABELS[task.priority]?.label || task.priority}
      value={task.priority}
      options={priorityOptions}
      onChange={(value) => void updateTaskField(task.id, 'priority', value)}
      ariaLabel="Приоритет"
    />
  );
  const deadline = (
    <Input
      aria-label="Дедлайн"
      type="date"
      value={inputDate(task.dueDate)}
      onChange={(event) => void updateTaskField(task.id, 'deadline', event.target.value || null)}
      className={
        controlClass +
        (needsDeadlineAttention(task)
          ? ' bg-yellow-500/15 text-yellow-800 dark:text-yellow-200'
          : '')
      }
    />
  );
  const estimate = (
    <Input
      aria-label="План, часы"
      type="number"
      min="0"
      step="0.5"
      value={task.estimate || ''}
      onChange={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value) && value >= 0) void updateTaskField(task.id, 'estimate', value);
      }}
      className={controlClass}
    />
  );
  if (readOnly) {
    return (
      <>
        {visibleColumns.includes('stage') && (
          <TableCell className="text-muted-foreground">
            {STATUS_LABELS[task.status] || '—'}
          </TableCell>
        )}
        {visibleColumns.includes('assignee') && <TableCell>{assignee}</TableCell>}
        {visibleColumns.includes('priority') && <TableCell>{priority}</TableCell>}
        {visibleColumns.includes('deadline') && <TableCell>{deadline}</TableCell>}
        {visibleColumns.includes('estimate') && <TableCell>{estimate}</TableCell>}
      </>
    );
  }

  if (!compact)
    return (
      <>
        {visibleColumns.includes('stage') && <TableCell>{phase}</TableCell>}
        {visibleColumns.includes('assignee') && <TableCell>{assignee}</TableCell>}
        {visibleColumns.includes('priority') && <TableCell>{priority}</TableCell>}
        {visibleColumns.includes('deadline') && <TableCell>{deadline}</TableCell>}
        {visibleColumns.includes('estimate') && <TableCell>{estimate}</TableCell>}
      </>
    );
  return (
    <div className="grid gap-1.5">
      {label('Фаза', phase)}
      {label('Исполнитель', assignee)}
      {label('Приоритет', priority)}
      {label('Дедлайн', deadline)}
      {label('План, ч', estimate)}
      <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted-foreground">
        <span>Факт, ч</span>
        <span className="px-2 text-sm text-foreground">{task.actualTime || 0} ч</span>
      </div>
    </div>
  );
}

function ProjectField({ task, readOnly }: { task: BxTask; readOnly: boolean }) {
  const { projects, moveTaskToProject } = useKanbanStore();
  const options = [
    { value: 'none', label: 'Без проекта' },
    ...projects
      .filter((project) => !project.isArchived)
      .map((project) => ({ value: project.id, label: project.name })),
  ];
  if (readOnly)
    return <>{projects.find((project) => project.id === task.projectId)?.name ?? '—'}</>;
  return (
    <InlineSelect
      label={projects.find((project) => project.id === task.projectId)?.name ?? '—'}
      value={task.projectId || 'none'}
      options={options}
      onChange={(value) => value !== 'none' && void moveTaskToProject(task.id, value)}
      ariaLabel="Проект"
    />
  );
}

function TaskActions({ task, compact = false }: { task: BxTask; compact?: boolean }) {
  const { moveTask } = useKanbanStore();
  const { openTask } = useTaskUrl();
  return (
    <div className="flex items-center">
      {!compact && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Открыть карточку ${task.title}`}
          title="Открыть карточку"
          onClick={() => openTask(task.id)}
        >
          <ExternalLink className="size-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Действия для ${task.title}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Быстрые действия</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => openTask(task.id)}>
            <ExternalLink />
            Открыть карточку
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void moveTask(task.id, task.status === 'done' ? 'new' : 'done')}
          >
            {task.status === 'done' ? <Circle /> : <CheckCircle2 />}
            {task.status === 'done' ? 'Вернуть в работу' : 'Отметить выполненной'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function TaskGrid({
  tasks,
  showProject = false,
  title,
  initialStatus = 'all',
  initialGroupBy = 'none',
  initialAssigneeId = 'all',
  viewScope,
  layoutScope = 'all',
  onLoadMore,
  hasMore = false,
  totalCount,
}: {
  tasks: BxTask[];
  showProject?: boolean;
  title?: string | null;
  initialStatus?: string;
  initialGroupBy?: GroupBy;
  initialAssigneeId?: string;
  viewScope?: 'all' | 'my';
  layoutScope?: string;
  onLoadMore?: () => Promise<void>;
  hasMore?: boolean;
  totalCount?: number;
}) {
  const selectedTaskId = useKanbanStore((state) => state.selectedTaskId);
  const setSelectedTask = useKanbanStore((state) => state.setSelectedTask);
  const updateTaskField = useKanbanStore((state) => state.updateTaskField);
  const { openTask, closeTask } = useTaskUrl();
  const createTask = useKanbanStore((state) => state.createTask);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  const stages = useKanbanStore((state) => state.stages);
  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId),
    [tasks, selectedTaskId],
  );
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [hideDone, setHideDone] = useState(true);
  const [assigneeFilter, setAssigneeFilter] = useState(initialAssigneeId);
  const [projectFilter, setProjectFilter] = useState('all');
  const [groupBy, setGroupBy] = useState<GroupBy>(initialGroupBy);
  const [draftQuery, setDraftQuery] = useState('');
  const [draftStatusFilter, setDraftStatusFilter] = useState(initialStatus);
  const [draftHideDone, setDraftHideDone] = useState(false);
  const [draftAssigneeFilter, setDraftAssigneeFilter] = useState(initialAssigneeId);
  const [draftProjectFilter, setDraftProjectFilter] = useState('all');
  const [draftGroupBy, setDraftGroupBy] = useState<GroupBy>(initialGroupBy);
  const [showFilters, setShowFilters] = useState(false);
  const [sorts, setSorts] = useState<Sort[]>([{ key: 'updated', direction: 'desc' }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState(COLUMN_WIDTHS);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [loadedLayoutScope, setLoadedLayoutScope] = useState<string | null>(null);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState('');
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [addingStageId, setAddingStageId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const availableColumns = (Object.keys(COLUMN_LABELS) as ColumnKey[]).filter(
    (column) => showProject || column !== 'project',
  );
  const orderedVisibleColumns = visibleColumns.filter((column) =>
    availableColumns.includes(column),
  );
  const hiddenColumns = availableColumns.filter((column) => !visibleColumns.includes(column));
  const reorderColumns = (activeId: string, overId: string) => {
    setLayoutDirty(true);
    setVisibleColumns((columns) => {
      const oldIndex = columns.indexOf(activeId as ColumnKey);
      const newIndex = columns.indexOf(overId as ColumnKey);
      return oldIndex < 0 || newIndex < 0 ? columns : arrayMove(columns, oldIndex, newIndex);
    });
  };
  const toggleColumn = (column: ColumnKey, checked: boolean) => {
    setLayoutDirty(true);
    setVisibleColumns((columns) =>
      checked ? [...columns, column] : columns.filter((item) => item !== column),
    );
  };
  const activeFilterCount = [
    draftStatusFilter !== 'all',
    draftHideDone,
    draftAssigneeFilter !== 'all',
    showProject && draftProjectFilter !== 'all',
  ].filter(Boolean).length;

  const orderedTasks = useMemo(() => {
    const value = (task: BxTask, key: SortKey) => {
      if (key === 'project') return projectById[task.projectId]?.name || '';
      if (key === 'stage') return task.stageId;
      if (key === 'assignee') return task.assigneeName || '';
      if (key === 'priority') return ['low', 'medium', 'high', 'critical'].indexOf(task.priority);
      if (key === 'deadline') return task.dueDate || '9999-12-31';
      if (key === 'estimate') return task.estimate;
      if (key === 'actual') return task.actualTime;
      if (key === 'updated') return task.updatedDate;
      if (key === 'description') return task.description;
      if (key === 'created') return task.createdDate;
      if (key === 'comments') return task.commentsCount ?? task.comments.length;
      if (key === 'parent') return task.parentId || '';
      if (key === 'storyPoints') return task.storyPoints || 0;
      if (key === 'tags') return extractTaskTags(task.title, task.description).join(' ');
      return task.title;
    };
    const needle = query.trim().toLocaleLowerCase('ru');
    const matchingTasks = tasks
      .filter((task) => {
        if (hideDone && task.status === 'done') return false;
        if (statusFilter === 'active') {
          if (task.status === 'done') return false;
        } else if (statusFilter === 'overdue') {
          if (!task.dueDate || task.status === 'done' || new Date(task.dueDate) >= new Date())
            return false;
        } else if (statusFilter === 'attention') {
          if (!needsDeadlineAttention(task)) return false;
        } else if (statusFilter === 'week') {
          if (!isDueThisWeek(task)) return false;
        } else if (statusFilter === 'no_deadline') {
          if (task.dueDate || task.status === 'done') return false;
        } else if (statusFilter !== 'all' && task.status !== statusFilter) return false;
        if (assigneeFilter !== 'all' && task.assigneeId !== assigneeFilter) return false;
        if (showProject && projectFilter !== 'all' && task.projectId !== projectFilter)
          return false;
        const searchText = `${task.title} ${task.id} ${task.description} ${projectById[task.projectId]?.name || ''} ${task.assigneeName || ''} ${stages.find((stage) => stage.id === task.stageId)?.name || ''}`;
        return !needle || searchText.toLocaleLowerCase('ru').includes(needle);
      })
      .sort((left, right) => {
        for (const sort of sorts) {
          const leftValue = value(left, sort.key);
          const rightValue = value(right, sort.key);
          const result =
            typeof leftValue === 'number' && typeof rightValue === 'number'
              ? leftValue - rightValue
              : String(leftValue).localeCompare(String(rightValue), 'ru');
          if (result) return sort.direction === 'asc' ? result : -result;
        }
        return 0;
      });
    if (groupBy !== 'hierarchy') return matchingTasks;

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const visibleIds = new Set(matchingTasks.map((task) => task.id));
    const ranks = new Map(matchingTasks.map((task, index) => [task.id, index]));
    for (const task of matchingTasks) {
      let parentId = task.parentId;
      while (parentId && !visibleIds.has(parentId)) {
        const parent = taskById.get(parentId);
        if (!parent) break;
        visibleIds.add(parent.id);
        ranks.set(parent.id, Math.min(ranks.get(parent.id) ?? Infinity, ranks.get(task.id) ?? 0));
        parentId = parent.parentId;
      }
    }
    const children = new Map<string, BxTask[]>();
    const roots: BxTask[] = [];
    for (const task of tasks) {
      if (!visibleIds.has(task.id)) continue;
      if (task.parentId && visibleIds.has(task.parentId)) {
        const siblings = children.get(task.parentId) || [];
        siblings.push(task);
        children.set(task.parentId, siblings);
      } else {
        roots.push(task);
      }
    }
    const sortTree = (items: BxTask[]) =>
      items.sort(
        (left, right) => (ranks.get(left.id) ?? Infinity) - (ranks.get(right.id) ?? Infinity),
      );
    const result: BxTask[] = [];
    const walk = (task: BxTask, seen = new Set<string>()) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      result.push(task);
      sortTree(children.get(task.id) || []).forEach((child) => walk(child, seen));
    };
    sortTree(roots).forEach((task) => walk(task));
    return result;
  }, [
    assigneeFilter,
    projectById,
    projectFilter,
    query,
    showProject,
    sorts,
    stages,
    statusFilter,
    hideDone,
    tasks,
    groupBy,
  ]);
  const loadedPageCount = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const pageCount = Math.max(1, Math.ceil(orderedTasks.length / PAGE_SIZE));
  const totalPageCount = totalCount ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) : pageCount;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageTasks = orderedTasks.slice(pageStart, pageStart + PAGE_SIZE);
  const loadNextPage = async () => {
    if (page < loadedPageCount) {
      setPage((value) => value + 1);
      return;
    }
    if (hasMore && onLoadMore) {
      await onLoadMore();
      setPage((value) => value + 1);
    }
  };
  const hierarchy = useMemo(() => {
    const pageTaskIds = new Set(pageTasks.map((task) => task.id));
    const pageTaskById = new Map(pageTasks.map((task) => [task.id, task]));
    const childCount = new Map<string, number>();
    const depthById = new Map<string, number>();
    const isVisible = new Map<string, boolean>();
    for (const task of pageTasks) {
      if (task.parentId && pageTaskIds.has(task.parentId)) {
        childCount.set(task.parentId, (childCount.get(task.parentId) || 0) + 1);
      }
      let depth = 0;
      let parentId = task.parentId;
      let visible = true;
      const seen = new Set<string>();
      while (parentId && pageTaskById.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        depth += 1;
        if (collapsedTaskIds.has(parentId)) visible = false;
        parentId = pageTaskById.get(parentId)?.parentId;
      }
      depthById.set(task.id, depth);
      isVisible.set(task.id, visible);
    }
    return { childCount, depthById, isVisible };
  }, [collapsedTaskIds, pageTasks]);
  const displayPageTasks =
    groupBy === 'hierarchy'
      ? pageTasks.filter((task) => hierarchy.isVisible.get(task.id))
      : pageTasks;
  const groupedPageTasks = useMemo(() => {
    if (groupBy === 'none' || groupBy === 'hierarchy')
      return [{ key: '', label: '', tasks: displayPageTasks }];
    const labels =
      groupBy === 'stage'
        ? Object.fromEntries(stages.map((stage) => [stage.id, stage.name]))
        : Object.fromEntries(users.map((user) => [user.id, user.name]));
    return Object.entries(
      displayPageTasks.reduce<Record<string, BxTask[]>>((groups, task) => {
        const key = groupBy === 'stage' ? task.stageId : task.assigneeId || '';
        (groups[key] ||= []).push(task);
        return groups;
      }, {}),
    ).map(([key, groupedTasks]) => ({
      key,
      label: labels[key] || (groupBy === 'stage' ? 'Без фазы' : 'Не назначен'),
      tasks: groupedTasks,
    }));
  }, [displayPageTasks, groupBy, stages, users]);
  const tableColumnCount = orderedVisibleColumns.length + 2;
  // Data arrives in PAGE_SIZE-sized chunks, so a short unfiltered list may
  // still be incomplete. Let only a deliberately narrowed, partial result
  // grow with its content; otherwise preserve the compact scrollport.
  const hasNarrowingFilter =
    Boolean(query.trim()) ||
    statusFilter !== 'all' ||
    hideDone ||
    assigneeFilter !== 'all' ||
    (showProject && projectFilter !== 'all');
  const tableHeightClass =
    hasNarrowingFilter && orderedTasks.length < PAGE_SIZE
      ? 'max-h-none'
      : showProject
        ? 'max-h-[calc(100dvh-17rem)]'
        : 'max-h-[calc(100dvh-28rem)]';
  const tableScrollClass =
    tableHeightClass === 'max-h-none' ? 'overflow-x-auto' : 'overflow-auto overscroll-contain';
  const pageNumbers = Array.from(
    new Set(
      [1, page - 1, page, page + 1, loadedPageCount].filter(
        (value) => value >= 1 && value <= loadedPageCount,
      ),
    ),
  ).sort((left, right) => left - right);

  useEffect(() => {
    setStatusFilter(initialStatus);
    setDraftStatusFilter(initialStatus);
  }, [initialStatus]);
  useEffect(() => {
    setAssigneeFilter(initialAssigneeId);
    setDraftAssigneeFilter(initialAssigneeId);
  }, [initialAssigneeId]);

  useEffect(() => {
    if (!viewScope) return;
    void fetch(`/api/task-views?scope=${viewScope}`)
      .then((response) => response.json())
      .then((data) => setViews(data.views || []));
  }, [viewScope]);

  useEffect(() => {
    let cancelled = false;
    setLoadedLayoutScope(null);
    setLayoutDirty(false);
    setVisibleColumns(DEFAULT_COLUMNS);
    setColumnWidths(COLUMN_WIDTHS);
    void fetch(`/api/task-grid-preferences?scope=${encodeURIComponent(layoutScope)}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !data.preference) return;
        setVisibleColumns(normalizeVisibleColumns(data.preference.visibleColumns));
        if (data.preference.columnWidths && typeof data.preference.columnWidths === 'object') {
          setColumnWidths((current) => ({ ...current, ...data.preference.columnWidths }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedLayoutScope(layoutScope);
      });
    return () => {
      cancelled = true;
    };
  }, [layoutScope]);

  useEffect(() => {
    if (loadedLayoutScope !== layoutScope || !layoutDirty) return;
    const timer = window.setTimeout(() => {
      void fetch('/api/task-grid-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: layoutScope, config: { visibleColumns, columnWidths } }),
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [columnWidths, layoutDirty, layoutScope, loadedLayoutScope, visibleColumns]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [assigneeFilter, groupBy, projectFilter, query, sorts, statusFilter, hideDone, tasks]);
  useEffect(() => {
    setCollapsedTaskIds(new Set());
  }, [groupBy]);

  const applyFilters = () => {
    setQuery(draftQuery);
    setStatusFilter(draftStatusFilter);
    setHideDone(draftHideDone);
    setAssigneeFilter(draftAssigneeFilter);
    setProjectFilter(draftProjectFilter);
    setGroupBy(draftGroupBy);
  };
  const resetFilters = () => {
    setDraftQuery('');
    setDraftStatusFilter('all');
    setDraftHideDone(false);
    setDraftAssigneeFilter('all');
    setDraftProjectFilter('all');
    setQuery('');
    setStatusFilter('all');
    setHideDone(false);
    setAssigneeFilter('all');
    setProjectFilter('all');
  };
  const filtersDirty =
    draftQuery !== query ||
    draftStatusFilter !== statusFilter ||
    draftHideDone !== hideDone ||
    draftAssigneeFilter !== assigneeFilter ||
    draftProjectFilter !== projectFilter;
  const applyView = (id: string) => {
    if (id === 'default') {
      setActiveViewId('');
      setDraftStatusFilter(initialStatus);
      setDraftHideDone(false);
      setDraftAssigneeFilter('all');
      setDraftProjectFilter('all');
      setDraftGroupBy('none');
      setStatusFilter(initialStatus);
      setHideDone(false);
      setAssigneeFilter('all');
      setProjectFilter('all');
      setGroupBy('none');
      setSorts([{ key: 'updated', direction: 'desc' }]);
      setVisibleColumns(DEFAULT_COLUMNS);
      setColumnWidths(COLUMN_WIDTHS);
      setLayoutDirty(true);
      return;
    }
    setActiveViewId(id);
    const view = views.find((item) => item.id === id);
    if (!view) return;
    const config = view.config;
    setDraftStatusFilter(config.statusFilter);
    setDraftHideDone(config.hideDone);
    setDraftAssigneeFilter(config.assigneeFilter);
    setDraftProjectFilter(config.projectFilter);
    setDraftGroupBy(config.groupBy);
    setStatusFilter(config.statusFilter);
    setHideDone(config.hideDone);
    setAssigneeFilter(config.assigneeFilter);
    setProjectFilter(config.projectFilter);
    setGroupBy(config.groupBy);
    setSorts(config.sorts);
    setVisibleColumns(normalizeVisibleColumns(config.visibleColumns));
    if (config.columnWidths) setColumnWidths((current) => ({ ...current, ...config.columnWidths }));
    setLayoutDirty(false);
  };
  const saveView = async () => {
    const name = viewName.trim();
    if (!name || !viewScope) return;
    const config = {
      statusFilter: draftStatusFilter,
      assigneeFilter: draftAssigneeFilter,
      projectFilter: draftProjectFilter,
      groupBy: draftGroupBy,
      hideDone: draftHideDone,
      sorts,
      visibleColumns,
      columnWidths,
    };
    const response = await fetch('/api/task-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scope: viewScope, config }),
    });
    const { view } = await response.json();
    if (view) {
      setViews((items) => [...items, view]);
      setActiveViewId(view.id);
      setSaveViewOpen(false);
      setViewName('');
    }
  };
  const toggleSelected = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelectedIds((current) =>
      pageTasks.every((task) => current.has(task.id))
        ? new Set([...current].filter((id) => !pageTasks.some((task) => task.id === id)))
        : new Set([...current, ...pageTasks.map((task) => task.id)]),
    );
  const applyBulk = (field: 'assigneeId' | 'status', value: string) => {
    void Promise.all([...selectedIds].map((id) => updateTaskField(id, field, value)));
    setSelectedIds(new Set());
  };
  const toggleSort = (key: SortKey) => {
    setSorts((current) => {
      const currentSort = current.find((sort) => sort.key === key);
      if (currentSort?.direction === 'desc') {
        return current.filter((sort) => sort.key !== key);
      }
      const next: Sort = { key, direction: currentSort ? 'desc' : 'asc' };
      return [next, ...current.filter((sort) => sort.key !== key)];
    });
  };
  const sortLabel = (key: SortKey) => {
    const index = sorts.findIndex((sort) => sort.key === key);
    return index < 0
      ? ''
      : `${sorts[index].direction === 'asc' ? '↑' : '↓'}${sorts.length > 1 ? index + 1 : ''}`;
  };
  const resizeColumn = (key: SortKey, startX: number, startWidth: number) => {
    setLayoutDirty(true);
    const move = (event: PointerEvent) =>
      setColumnWidths((widths) => ({
        ...widths,
        [key]: Math.max(80, startWidth + event.clientX - startX),
      }));
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };
  const sortableHead = (key: SortKey, label: string) => (
    <TableHead className="relative p-0" style={{ width: columnWidths[key] }}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="flex h-10 w-full items-center gap-1 px-4 text-left hover:text-foreground"
      >
        {label}
        <span className="min-w-3 text-xs">{sortLabel(key)}</span>
      </button>
      <span
        role="separator"
        aria-label={`Изменить ширину столбца ${label}`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          resizeColumn(key, event.clientX, columnWidths[key]);
        }}
        className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-primary"
      />
    </TableHead>
  );

  if (tasks.length === 0)
    return (
      <Card className="mx-4 mt-5 border-dashed sm:mx-6">
        <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground">
            <Circle className="size-6" />
          </div>
          <div>
            <h2 className="font-semibold">Нет задач</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showProject
                ? 'По выбранным фильтрам ничего не найдено.'
                : 'Измените фильтры или создайте первую задачу на доске.'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  const isReadOnly = showProject;
  return (
    <>
      <Card className="mx-4 mt-5 gap-2 rounded-none bg-transparent py-0 shadow-none ring-0 sm:mx-6">
        <CardHeader className="gap-2 rounded-none border-0 bg-transparent px-0 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {title !== null && (
              <CardTitle className="shrink-0 text-base">{title ?? 'Задачи проекта'}</CardTitle>
            )}
            {viewScope && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-md focus:ring-0 focus-visible:ring-2 aria-expanded:bg-background aria-expanded:text-foreground"
                  >
                    {views.find((view) => view.id === activeViewId)?.name || 'По умолчанию'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    className="focus:bg-transparent focus:text-foreground focus-visible:bg-accent"
                    onClick={() => applyView('default')}
                  >
                    По умолчанию
                  </DropdownMenuItem>
                  {views.map((view) => (
                    <DropdownMenuItem
                      key={view.id}
                      className="focus:bg-transparent focus:text-foreground focus-visible:bg-accent"
                      onClick={() => applyView(view.id)}
                    >
                      {view.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="focus:bg-transparent focus:text-foreground focus-visible:bg-accent"
                    onClick={() => setSaveViewOpen(true)}
                  >
                    Сохранить текущий вид
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters();
              }}
              placeholder="Поиск задач…"
              className="h-8 rounded-md w-full sm:w-56 lg:w-auto lg:min-w-72 lg:flex-1 xl:max-w-[32rem]"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 rounded-md">
                  Поля
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56 max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>Перетащите, чтобы изменить порядок</DropdownMenuLabel>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={({ active, over }) => {
                    if (over && active.id !== over.id)
                      reorderColumns(String(active.id), String(over.id));
                  }}
                >
                  <SortableContext
                    items={orderedVisibleColumns}
                    strategy={verticalListSortingStrategy}
                  >
                    {orderedVisibleColumns.map((column) => (
                      <SortableVisibleColumn key={column} column={column} onToggle={toggleColumn} />
                    ))}
                  </SortableContext>
                </DndContext>
                {hiddenColumns.length > 0 && <DropdownMenuSeparator />}
                {hiddenColumns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column}
                    checked={false}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => toggleColumn(column, checked)}
                  >
                    {COLUMN_LABELS[column]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <select
              aria-label="Группировка"
              value={draftGroupBy}
              onChange={(event) => {
                const value = event.target.value;
                if (!isGroupBy(value)) return;
                setDraftGroupBy(value);
                setGroupBy(value);
              }}
              className="h-8 w-40 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 dark:bg-input/30 dark:hover:bg-input/50"
            >
              {GROUP_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              variant={showFilters || activeFilterCount > 0 ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 rounded-md"
              onClick={() => setShowFilters((open) => !open)}
            >
              <Filter size={14} />
              Фильтры
              {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount}</Badge>}
            </Button>
            {showFilters && (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2.5">
                <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30 dark:hover:bg-input/50">
                  <Checkbox
                    checked={draftHideDone}
                    onCheckedChange={(value) => setDraftHideDone(value === true)}
                    aria-label="Скрыть закрытые задачи"
                  />
                  <span>Скрыть закрытые</span>
                </label>
                <Select value={draftStatusFilter} onValueChange={setDraftStatusFilter}>
                  <SelectTrigger className="w-32 rounded-md" aria-label="Статус">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все задачи</SelectItem>
                    <SelectItem value="active">Активные задачи</SelectItem>
                    <SelectItem value="attention">Требуют внимания</SelectItem>
                    <SelectItem value="week">Дедлайн на неделе</SelectItem>
                    <SelectItem value="no_deadline">Без дедлайна</SelectItem>
                    <SelectItem value="overdue">Просрочено</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={draftAssigneeFilter} onValueChange={setDraftAssigneeFilter}>
                  <SelectTrigger className="w-40 rounded-md" aria-label="Исполнитель">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все исполнители</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showProject && (
                  <Select value={draftProjectFilter} onValueChange={setDraftProjectFilter}>
                    <SelectTrigger className="w-40 rounded-md" aria-label="Проект">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все проекты</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-md"
                  disabled={!filtersDirty}
                  onClick={applyFilters}
                >
                  Применить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                  disabled={
                    !draftQuery &&
                    draftStatusFilter === 'all' &&
                    !draftHideDone &&
                    draftAssigneeFilter === 'all' &&
                    draftProjectFilter === 'all'
                  }
                  onClick={resetFilters}
                >
                  Сбросить
                </Button>
              </div>
            )}
          </div>
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 text-sm">
              <span className="font-medium">Выбрано: {selectedIds.size}</span>
              <Select onValueChange={(value) => applyBulk('assigneeId', value)}>
                <SelectTrigger className="w-44" aria-label="Назначить исполнителя">
                  <SelectValue placeholder="Назначить…" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select onValueChange={(value) => applyBulk('status', value)}>
                <SelectTrigger className="w-40" aria-label="Сменить статус">
                  <SelectValue placeholder="Сменить статус…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Новая</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="done">Готово</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Снять выбор
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y md:hidden">
            {displayPageTasks.map((task) => {
              const assignee =
                users.find((user) => user.id === task.assigneeId)?.name || 'Не назначен';
              const priority = PRIORITY_LABELS[task.priority]?.label || 'Обычный';
              return (
                <article
                  key={task.id}
                  className={`max-w-full min-w-0 overflow-hidden p-4 ${
                    task.status === 'done'
                      ? 'bg-muted/60 text-muted-foreground'
                      : needsDeadlineAttention(task)
                        ? 'bg-yellow-500/10'
                        : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={selectedIds.has(task.id)}
                      onCheckedChange={() => toggleSelected(task.id)}
                      aria-label={`Выбрать задачу ${task.title}`}
                      className="mt-1.5"
                    />
                    {groupBy === 'hierarchy' && (hierarchy.childCount.get(task.id) || 0) > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mt-0.5 size-6 shrink-0"
                        aria-label={
                          collapsedTaskIds.has(task.id)
                            ? `Развернуть подзадачи ${task.title}`
                            : `Свернуть подзадачи ${task.title}`
                        }
                        onClick={() =>
                          setCollapsedTaskIds((ids) => {
                            const next = new Set(ids);
                            if (next.has(task.id)) next.delete(task.id);
                            else next.add(task.id);
                            return next;
                          })
                        }
                      >
                        {collapsedTaskIds.has(task.id) ? (
                          <ChevronRight className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => openTask(task.id)}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none"
                      style={{
                        paddingLeft:
                          groupBy === 'hierarchy'
                            ? `${(hierarchy.depthById.get(task.id) || 0) * 16}px`
                            : undefined,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {task.status === 'done' ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0" />
                        )}
                        <p className="line-clamp-2 font-medium">
                          {groupBy === 'hierarchy' &&
                            (hierarchy.depthById.get(task.id) || 0) > 0 &&
                            '↳ '}
                          {task.title}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{STATUS_LABELS[task.status] || task.status}</span>
                        <span>{priority}</span>
                        {showProject && <span>{projectById[task.projectId]?.name ?? '—'}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{assignee}</span>
                        {!task.dueDate && task.status !== 'done' && (
                          <span className="font-medium text-violet-700 dark:text-violet-300">
                            без срока
                          </span>
                        )}
                        {task.dueDate && (
                          <span
                            className={
                              needsDeadlineAttention(task)
                                ? 'font-medium text-yellow-800 dark:text-yellow-200'
                                : undefined
                            }
                          >
                            до {formatBitrixDateTime(task.dueDate)}
                          </span>
                        )}
                        {task.estimate || task.actualTime ? (
                          <span>
                            факт {task.actualTime || 0} ч, план {task.estimate || 0} ч
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <TaskActions task={task} />
                  </div>
                </article>
              );
            })}
          </div>
          <div className={`hidden md:block ${tableScrollClass} ${tableHeightClass}`}>
            <Table className="min-w-max table-fixed" containerClassName="overflow-visible">
              <colgroup>
                <col className="w-10" />
                {orderedVisibleColumns.map((column) => (
                  <col key={column} style={{ width: columnWidths[column] }} />
                ))}
                <col className="w-20" />
              </colgroup>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-background [&_th]:shadow-[0_1px_0_0_var(--border)]">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        pageTasks.length > 0 && pageTasks.every((task) => selectedIds.has(task.id))
                      }
                      onCheckedChange={togglePage}
                      aria-label="Выбрать задачи на странице"
                    />
                  </TableHead>
                  {orderedVisibleColumns.map((column) =>
                    sortableHead(
                      column,
                      column === 'stage' && showProject
                        ? 'Статус'
                        : column === 'estimate'
                          ? 'План, ч'
                          : column === 'actual'
                            ? 'Факт, ч'
                            : COLUMN_LABELS[column],
                    ),
                  )}
                  <TableHead className="w-20">
                    <span className="sr-only">Действия</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedPageTasks.map((group) => (
                  <Fragment key={`${groupBy}:${group.key || 'all'}`}>
                    {groupBy !== 'none' && groupBy !== 'hierarchy' && (
                      <TableRow className="bg-muted/60 hover:bg-muted/60">
                        <TableCell
                          colSpan={tableColumnCount}
                          className="font-medium text-foreground"
                        >
                          {group.label} ({group.tasks.length})
                        </TableCell>
                      </TableRow>
                    )}
                    {group.tasks.map((task) => (
                      <TableRow
                        key={task.id}
                        className={
                          task.status === 'done'
                            ? 'bg-muted/60 text-muted-foreground'
                            : needsDeadlineAttention(task)
                              ? 'bg-yellow-500/10 hover:bg-yellow-500/15'
                              : ''
                        }
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(task.id)}
                            onCheckedChange={() => toggleSelected(task.id)}
                            aria-label={`Выбрать задачу ${task.title}`}
                          />
                        </TableCell>
                        {orderedVisibleColumns.map((column) => {
                          if (column === 'title') {
                            return (
                              <TableCell key={column}>
                                <EditableTitle
                                  task={task}
                                  tree={
                                    groupBy === 'hierarchy'
                                      ? {
                                          depth: hierarchy.depthById.get(task.id) || 0,
                                          hasChildren: (hierarchy.childCount.get(task.id) || 0) > 0,
                                          expanded: !collapsedTaskIds.has(task.id),
                                          onToggle: () =>
                                            setCollapsedTaskIds((ids) => {
                                              const next = new Set(ids);
                                              if (next.has(task.id)) next.delete(task.id);
                                              else next.add(task.id);
                                              return next;
                                            }),
                                        }
                                      : undefined
                                  }
                                />
                              </TableCell>
                            );
                          }
                          if (column === 'project') {
                            return (
                              <TableCell key={column}>
                                <ProjectField task={task} readOnly={false} />
                              </TableCell>
                            );
                          }
                          if (
                            column === 'stage' ||
                            column === 'assignee' ||
                            column === 'priority' ||
                            column === 'deadline' ||
                            column === 'estimate'
                          ) {
                            return (
                              <Fragment key={column}>
                                <FieldControls
                                  task={task}
                                  readOnly={isReadOnly}
                                  visibleColumns={[column]}
                                />
                              </Fragment>
                            );
                          }
                          if (column === 'actual') {
                            return (
                              <TableCell key={column} className="text-muted-foreground">
                                {task.actualTime || 0} ч
                              </TableCell>
                            );
                          }
                          if (column === 'description') {
                            return (
                              <TableCell
                                key={column}
                                className="max-w-64 truncate text-muted-foreground"
                              >
                                {task.description || '—'}
                              </TableCell>
                            );
                          }
                          if (column === 'created' || column === 'updated') {
                            return (
                              <TableCell key={column} className="text-muted-foreground">
                                {formatBitrixDateTime(
                                  column === 'created' ? task.createdDate : task.updatedDate,
                                )}
                              </TableCell>
                            );
                          }
                          if (column === 'comments') {
                            return (
                              <TableCell key={column} className="text-muted-foreground">
                                {task.commentsCount ?? task.comments.length}
                              </TableCell>
                            );
                          }
                          if (column === 'parent') {
                            return (
                              <TableCell key={column} className="text-muted-foreground">
                                {task.parentId ? `#${task.parentId}` : '—'}
                              </TableCell>
                            );
                          }
                          if (column === 'storyPoints') {
                            return (
                              <TableCell key={column} className="text-muted-foreground">
                                {task.storyPoints ?? '—'}
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={column}>
                              <TaskTags task={task} />
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          <TaskActions task={task} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {groupBy === 'stage' && !showProject && group.key !== '0' && (
                      <TableRow>
                        <TableCell colSpan={tableColumnCount} className="py-2">
                          {addingStageId === group.key ? (
                            <Input
                              autoFocus
                              value={newTaskTitle}
                              onChange={(event) => setNewTaskTitle(event.target.value)}
                              onBlur={() => {
                                setAddingStageId(null);
                                setNewTaskTitle('');
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && newTaskTitle.trim()) {
                                  void createTask({
                                    title: newTaskTitle.trim(),
                                    stageId: group.key,
                                  });
                                  setNewTaskTitle('');
                                  setAddingStageId(null);
                                }
                                if (event.key === 'Escape') {
                                  setAddingStageId(null);
                                  setNewTaskTitle('');
                                }
                              }}
                              placeholder="Название новой задачи"
                              className="h-8"
                            />
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              onClick={() => setAddingStageId(group.key)}
                            >
                              + Добавить задачу
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        {(loadedPageCount > 1 || hasMore) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3 sm:px-6">
            <p className="text-sm text-muted-foreground">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, tasks.length)} из{' '}
              {totalCount || tasks.length}
              {totalCount ? `, страница ${page} из ${totalPageCount}` : ''}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-1" aria-label="Пагинация">
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setPage(1)}
                disabled={page === 1}
              >
                Первая
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((value) => value - 1)}
                disabled={page === 1}
              >
                Назад
              </Button>
              {pageNumbers.map((number) => (
                <Button
                  key={number}
                  variant={number === page ? 'default' : 'outline'}
                  size="sm"
                  className="w-9 px-0"
                  onClick={() => setPage(number)}
                >
                  {number}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadNextPage()}
                disabled={page >= loadedPageCount && !hasMore}
              >
                Вперёд
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setPage(pageCount)}
                disabled={hasMore || page === loadedPageCount}
              >
                Последняя
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Сохранить представление</DialogTitle>
          </DialogHeader>
          <Input
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            placeholder="Название вида"
            autoFocus
            onKeyDown={(event) => event.key === 'Enter' && void saveView()}
          />
          <DialogFooter>
            <Button onClick={() => void saveView()} disabled={!viewName.trim()}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {selectedTask && <TaskModal task={selectedTask} onClose={closeTask} />}
    </>
  );
}

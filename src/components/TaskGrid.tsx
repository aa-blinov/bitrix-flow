'use client';

// These effects synchronize controlled props and persisted grid state with the
// interactive client model; they intentionally update local state after mount.
/* eslint-disable react-hooks/set-state-in-effect */

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type AriaAttributes,
  isValidElement,
} from 'react';
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
  Folder,
  User,
  CalendarDays,
  Clock,
  Download,
  Pencil,
  Bookmark,
  CheckCheck,
} from 'lucide-react';
import { BxTask, PRIORITY_LABELS, STATUS_LABELS } from '@/types/bitrix';
import { isDueThisWeek, needsDeadlineAttention } from '@/lib/task-urgency';
import { extractTaskTags } from '@/lib/task-tags';
import { orderTasksAsTree } from '@/lib/task-tree';
import { fetchProjectStages } from '@/lib/bitrix24';
import { cn, getBitrixTaskUrl, toLocalInputValue } from '@/lib/utils';
import { formatBitrixDateTime } from '@/lib/bitrix-markup';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import TaskModal from './TaskModal';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Checkbox } from '@/components/monos/Checkbox';
import { Chip } from '@/components/monos/Chip';
import { Drawer } from '@/components/monos/Drawer';
import { IconButton } from '@/components/monos/IconButton';
import { Menu } from '@/components/monos/Menu';
import { Modal } from '@/components/monos/Modal';
import { Popover } from '@/components/monos/Popover';
import { SelectField } from '@/components/monos/SelectField';
import { Separator } from '@/components/monos/Separator';
import { TextField } from '@/components/monos/TextField';
import { toolbarControl, toolbarPanel, toolbarSelect } from '@/components/monos/toolbar';
import { useIsMobile } from '@/hooks/useIsMobile';
import QuickCreateTask from '@/components/QuickCreateTask';
import { useTaskToasts } from '@/components/monos/toast';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import TaskFilterBar from '@/components/TaskFilterBar';
import {
  EMPTY_FILTERS,
  decodeFiltersParam,
  encodeFiltersParam,
  initialFilterValues,
  taskFilterFields,
  taskFilterPresets,
  type FilterField,
  type FilterFieldKey,
  type FilterPreset,
  type FilterValues,
} from '@/lib/task-filters';
import LoadingState from '@/components/LoadingState';

// Поле прямо в строке таблицы: тихое до наведения, без заливки и рамки.
const cellFieldClass = '[&_input]:border-transparent [&_input]:hover:border-line';
// То же для списка: набор рисует выбор нативным select, а не кнопкой.
const cellSelectClass = '[&_select]:border-transparent [&_select]:hover:border-line';

// Таблица задач остаётся нативной: колонки с настраиваемой шириной, строки
// групп и Shift-сортировка не выражаются через data-API набора. Вид —
// наборный: тонкая линия, тихий текст, плотная строка.
function GridCell({
  className,
  colSpan,
  title,
  children,
}: {
  className?: string;
  colSpan?: number;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cn('border-b border-line px-2 py-1 align-middle text-sm', className)}
    >
      {children}
    </td>
  );
}

function GridHead({
  className,
  colSpan,
  style,
  ariaSort,
  children,
}: {
  className?: string;
  colSpan?: number;
  style?: CSSProperties;
  ariaSort?: AriaAttributes['aria-sort'];
  children?: ReactNode;
}) {
  return (
    <th
      scope="col"
      colSpan={colSpan}
      style={style}
      aria-sort={ariaSort}
      className={cn('bg-canvas p-0 text-left', className)}
    >
      {children}
    </th>
  );
}

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
const inputDate = (value?: string) => toLocalInputValue(value, 'date');
function dateWithKeptTime(day: string, previous?: string): string | null {
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  const base = previous ? new Date(previous) : null;
  const result = new Date(
    year,
    month - 1,
    date,
    base ? base.getHours() : 19,
    base ? base.getMinutes() : 0,
  );
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}
const PAGE_SIZE = 50;
// На телефоне 50 карточек — семь экранов прокрутки до пагинации.
const MOBILE_PAGE_SIZE = 20;

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
export type TaskGridPageQuery = {
  page: number;
  query: string;
  limit: number;
  sorts: Sort[];
  /** Все поля фильтра разом: страницы переводят их в параметры одной функцией. */
  filters: FilterValues;
  /** Группировка «Иерархия задач»: сервер дотянет родителей найденных подзадач. */
  hierarchy: boolean;
  /** Серверная группировка: project | stage | assignee | deadline | none. */
  groupBy: string;
};
export type TaskGridGroup = { key: string; label: string; count: number };
export type TaskGridPage = {
  tasks: BxTask[];
  total: number;
  ancestors?: BxTask[];
  groups?: TaskGridGroup[];
};
type ColumnKey = SortKey;
type GroupBy = 'none' | 'project' | 'stage' | 'assignee' | 'deadline' | 'hierarchy';
const GROUP_BY_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: 'none', label: 'Без группировки' },
  { value: 'project', label: 'По проекту' },
  { value: 'stage', label: 'По фазе' },
  { value: 'assignee', label: 'По исполнителю' },
  { value: 'deadline', label: 'По сроку' },
  { value: 'hierarchy', label: 'Иерархия задач' },
];
const isGroupBy = (value: string): value is GroupBy =>
  GROUP_BY_OPTIONS.some((option) => option.value === value);
type SavedView = {
  id: string;
  name: string;
  config: {
    // Плоские поля старых вью приводит к этому виду /api/task-views.
    filters: FilterValues;
    groupBy: GroupBy;
    sorts: Sort[];
    visibleColumns: ColumnKey[];
    columnWidths?: Partial<Record<SortKey, number>>;
  };
};
// Дедлайн сразу за исполнителем: последним он уезжал за правый край на
// обычном ноутбуке, и главный сигнал списка было не видно без прокрутки.
const DEFAULT_COLUMNS: ColumnKey[] = [
  'title',
  'project',
  'stage',
  'assignee',
  'deadline',
  'priority',
  'estimate',
  'actual',
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
  project: 160,
  stage: 140,
  assignee: 170,
  priority: 110,
  deadline: 140,
  estimate: 90,
  actual: 80,
  updated: 160,
  description: 260,
  created: 160,
  comments: 110,
  parent: 130,
  storyPoints: 120,
  tags: 220,
};

// Храним только ширины, которые юзер реально менял: раньше в базу уезжал весь
// словарь, и новые значения по умолчанию до сохранивших раскладку не доходили.
function customColumnWidths(widths: Record<SortKey, number>): Partial<Record<SortKey, number>> {
  return Object.fromEntries(
    (Object.keys(widths) as SortKey[])
      .filter((key) => widths[key] !== COLUMN_WIDTHS[key])
      .map((key) => [key, widths[key]]),
  );
}

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
      className={`flex items-center rounded-ui ${isDragging ? 'bg-surface-2 opacity-60' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none px-1 text-ink-faint transition-colors duration-fast hover:text-ink active:cursor-grabbing"
        aria-label={`Изменить порядок поля ${COLUMN_LABELS[column]}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} strokeWidth={1.7} />
      </button>
      {/* Подпись рядом с галкой, а не внутри неё: у набора галка — поле
          ввода, и текст в children сломал бы разметку. */}
      <label className="flex min-h-8 flex-1 cursor-pointer items-center gap-2 rounded-ui px-1 text-sm text-ink-soft hover:text-ink">
        <Checkbox
          checked
          disabled={column === 'title'}
          onChange={(event) => onToggle(column, event.currentTarget.checked)}
          ariaLabel={COLUMN_LABELS[column]}
        />
        <span className="min-w-0 flex-1 truncate">{COLUMN_LABELS[column]}</span>
      </label>
    </div>
  );
}

const EditableTitle = memo(function EditableTitle({
  task,
  tree,
}: {
  task: BxTask;
  tree?: { depth: number; hasChildren: boolean; expanded: boolean; onToggle: () => void };
}) {
  const updateTaskField = useKanbanStore((state) => state.updateTaskField);
  const toasts = useTaskToasts();
  const { openTask } = useTaskUrl();
  const [title, setTitle] = useState(task.title);
  const [editing, setEditing] = useState(false);
  useEffect(() => setTitle(task.title), [task.title]);
  const commit = () => {
    const next = title.trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title)
      void updateTaskField(task.id, 'title', next).catch((error) => {
        setTitle(task.title);
        toasts.failed('Название не сохранилось', error);
      });
  };
  return (
    <div
      className="flex min-w-0"
      style={{ paddingLeft: tree ? `${tree.depth * 20}px` : undefined }}
    >
      {tree?.hasChildren ? (
        <span className="mt-1 shrink-0">
          <IconButton
            variant="ghost"
            size="sm"
            className="size-6"
            label={
              tree.expanded
                ? `Свернуть подзадачи ${task.title}`
                : `Развернуть подзадачи ${task.title}`
            }
            onClick={tree.onToggle}
          >
            {tree.expanded ? (
              <ChevronDown size={16} strokeWidth={1.7} />
            ) : (
              <ChevronRight size={16} strokeWidth={1.7} />
            )}
          </IconButton>
        </span>
      ) : tree?.depth ? (
        <span className="mt-1 block size-6 shrink-0 border-l border-b border-ink-faint/30" />
      ) : null}
      <div className="min-w-0 flex-1">
        {/* Клик по названию открывает карточку — так ждут все списки задач.
            Переименование прячется за двойным кликом и карандашом: раньше
            название было полем ввода, и открыть задачу можно было только
            иконкой в конце строки. */}
        {editing ? (
          <TextField
            autoFocus
            aria-label={`Название задачи ${task.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              commit();
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setTitle(task.title);
                setEditing(false);
              }
            }}
            size="sm"
            variant="underline"
            className={`w-full max-w-full ${cellFieldClass} [&_input]:font-medium`}
          />
        ) : (
          <div className="group/title flex items-center gap-1">
            <button
              type="button"
              onClick={() => openTask(task.id)}
              onDoubleClick={() => setEditing(true)}
              className="min-w-0 flex-1 truncate rounded-ui px-1 py-1 text-left text-sm font-medium transition-colors duration-fast hover:bg-surface hover:underline"
              title={task.title}
            >
              {title}
            </button>
            <IconButton
              variant="ghost"
              size="sm"
              label={`Переименовать задачу ${task.id}`}
              tooltipText="Переименовать"
              className="opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} strokeWidth={1.7} />
            </IconButton>
          </div>
        )}
        <div className="mt-1 flex gap-2 px-1 text-xs text-ink-faint">
          <a
            href={getBitrixTaskUrl(task.id)}
            target="_blank"
            rel="noreferrer"
            className="transition-colors duration-fast hover:text-ink hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            #{task.id}
          </a>
          {task.parentId && (
            <button
              type="button"
              className="transition-colors duration-fast hover:text-ink hover:underline"
              onClick={() => openTask(task.parentId!)}
            >
              ↳ Подзадача #{task.parentId}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

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
  // Нативный список набора: значение выбирается сразу, без второго клика по
  // кнопке, а имя поля остаётся в подписи доступности.
  // Текущее значение добавляем в список, если его там нет (исполнитель не
  // подгрузился, проект в архиве): раньше кнопка всё равно показывала имя.
  const current = options.some((option) => option.value === value)
    ? options
    : [{ value, label }, ...options];
  return (
    <SelectField
      size="sm"
      variant="underline"
      // aria-label обязателен: иначе скринридер читает только значение
      // («Обычный») и не говорит, какое это поле.
      aria-label={`${ariaLabel}: ${label}`}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      options={current}
      className={`w-full min-w-0 ${cellSelectClass}`}
    />
  );
}

const TaskTags = memo(function TaskTags({ task }: { task: BxTask }) {
  const tags = task.tags?.length ? task.tags : extractTaskTags(task.title, task.description);
  if (tags.length === 0) return <span className="text-ink-faint">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Chip key={tag} size="sm" tone="neutral">
          {tag}
        </Chip>
      ))}
    </div>
  );
});

const FieldControls = memo(function FieldControls({
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
  const { users, stages, updateTaskField, moveTaskToStage } = useKanbanStore(
    useShallow((s) => ({
      users: s.users,
      stages: s.stages,
      updateTaskField: s.updateTaskField,
      moveTaskToStage: s.moveTaskToStage,
    })),
  );
  const toasts = useTaskToasts();
  // Правка уходит без подтверждения: молчим при успехе, но об отказе Битрикса
  // говорим — раньше значение просто прыгало обратно.
  const edit = (field: string, value: unknown, what: string) => {
    const previous = (task as unknown as Record<string, unknown>)[field];
    void updateTaskField(task.id, field, value)
      .then(() =>
        toasts.undoable(`${what}: изменено`, () =>
          updateTaskField(task.id, field, previous).catch((error) =>
            toasts.failed('Не удалось отменить', error),
          ),
        ),
      )
      .catch((error) => toasts.failed(`${what}: не сохранилось`, error));
  };
  const label = (name: string, child: React.ReactNode) => (
    <label className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 text-xs text-ink-soft">
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
      onChange={(value) => {
        const previous = task.stageId;
        void moveTaskToStage(task.id, value)
          .then(() =>
            toasts.undoable('Фаза изменена', () =>
              moveTaskToStage(task.id, previous).catch((error) =>
                toasts.failed('Не удалось отменить', error),
              ),
            ),
          )
          .catch((error) => toasts.failed('Фаза не сохранилась', error));
      }}
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
      onChange={(value) => edit('assigneeId', value === 'unassigned' ? '' : value, 'Исполнитель')}
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
      onChange={(value) => edit('priority', value, 'Приоритет')}
      ariaLabel="Приоритет"
    />
  );
  const deadline = (
    <TextField
      aria-label="Дедлайн"
      type="date"
      size="sm"
      variant="underline"
      value={inputDate(task.dueDate)}
      // Дата без времени Битрикс читает как полночь в поясе портала (+05:00) —
      // по Москве это 22:00 прошлого дня. Сохраняем время прежнего дедлайна
      // (или 19:00 по местному, если его не было) и шлём полный ISO.
      onChange={(event) =>
        edit('deadline', dateWithKeptTime(event.target.value, task.dueDate), 'Дедлайн')
      }
      title={task.dueDate ? formatBitrixDateTime(task.dueDate) : undefined}
      className={`w-full min-w-0 ${cellFieldClass} ${
        // Подсветка ячейки уже говорит «просрочено», поэтому сам текст даты
        // остаётся чернильным: сигнальный цвет на тонированном фоне в части
        // палитр не дотягивал до контраста 4.5:1.
        needsDeadlineAttention(task) ? '[&_input]:bg-warning/10 [&_input]:text-ink' : ''
      }`}
    />
  );
  const estimate = (
    <TextField
      aria-label="План, часы"
      type="number"
      min="0"
      step="0.5"
      size="sm"
      variant="underline"
      value={task.estimate || ''}
      onChange={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (Number.isFinite(value) && value >= 0) edit('estimate', value, 'Оценка');
      }}
      className={`w-full min-w-0 ${cellFieldClass}`}
    />
  );
  if (readOnly) {
    return (
      <>
        {visibleColumns.includes('stage') && (
          <GridCell className="text-ink-faint">{STATUS_LABELS[task.status] || '—'}</GridCell>
        )}
        {visibleColumns.includes('assignee') && <GridCell>{assignee}</GridCell>}
        {visibleColumns.includes('priority') && <GridCell>{priority}</GridCell>}
        {visibleColumns.includes('deadline') && <GridCell>{deadline}</GridCell>}
        {visibleColumns.includes('estimate') && <GridCell>{estimate}</GridCell>}
      </>
    );
  }

  if (!compact)
    return (
      <>
        {visibleColumns.includes('stage') && <GridCell>{phase}</GridCell>}
        {visibleColumns.includes('assignee') && <GridCell>{assignee}</GridCell>}
        {visibleColumns.includes('priority') && <GridCell>{priority}</GridCell>}
        {visibleColumns.includes('deadline') && <GridCell>{deadline}</GridCell>}
        {visibleColumns.includes('estimate') && <GridCell>{estimate}</GridCell>}
      </>
    );
  return (
    <div className="grid gap-1.5">
      {label('Фаза', phase)}
      {label('Исполнитель', assignee)}
      {label('Приоритет', priority)}
      {label('Дедлайн', deadline)}
      {label('План, ч', estimate)}
      <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-ink-soft">
        <span>Факт, ч</span>
        <span className="px-2 text-sm text-ink">{task.actualTime || 0} ч</span>
      </div>
    </div>
  );
});

const ProjectField = memo(function ProjectField({
  task,
  readOnly,
}: {
  task: BxTask;
  readOnly: boolean;
}) {
  const { projects, moveTaskToProject } = useKanbanStore(
    useShallow((s) => ({ projects: s.projects, moveTaskToProject: s.moveTaskToProject })),
  );
  const options = [
    { value: 'none', label: 'Без проекта' },
    ...projects
      .filter((project) => !project.isArchived)
      .map((project) => ({ value: project.id, label: project.name })),
  ];
  const label =
    projects.find((project) => project.id === task.projectId)?.name ??
    (task.projectId && task.projectId !== NO_PROJECT_ID ? '—' : NO_PROJECT_NAME);
  if (readOnly) return <>{label}</>;
  return (
    <InlineSelect
      label={label}
      value={task.projectId || 'none'}
      options={options}
      onChange={(value) => value !== 'none' && void moveTaskToProject(task.id, value)}
      ariaLabel="Проект"
    />
  );
});

const TaskActions = memo(function TaskActions({
  task,
  compact = false,
}: {
  task: BxTask;
  compact?: boolean;
}) {
  const { moveTask } = useKanbanStore(useShallow((s) => ({ moveTask: s.moveTask })));
  const { openTask } = useTaskUrl();
  // Пункты меню — данные: набор сам рисует кнопки и разделители.
  const items = [
    {
      label: 'Открыть карточку',
      icon: <ExternalLink size={14} strokeWidth={1.7} />,
      onSelect: () => openTask(task.id),
    },
    {
      label: task.status === 'done' ? 'Вернуть в работу' : 'Отметить выполненной',
      icon:
        task.status === 'done' ? (
          <Circle size={14} strokeWidth={1.7} />
        ) : (
          <CheckCircle2 size={14} strokeWidth={1.7} />
        ),
      onSelect: () => void moveTask(task.id, task.status === 'done' ? 'new' : 'done'),
    },
  ];
  return (
    <div className="flex items-center">
      {!compact && (
        <IconButton
          variant="ghost"
          size="md"
          label={`Открыть карточку ${task.title}`}
          tooltipText="Открыть карточку"
          onClick={() => openTask(task.id)}
        >
          <ExternalLink size={16} strokeWidth={1.7} />
        </IconButton>
      )}
      <Menu
        label={`Действия для ${task.title}`}
        align="end"
        items={items}
        trigger={
          <IconButton variant="ghost" size="md" label={`Действия для ${task.title}`}>
            <MoreHorizontal size={16} strokeWidth={1.7} />
          </IconButton>
        }
      />
    </div>
  );
});

export default function TaskGrid({
  tasks: initialTasks = [],
  showProject = false,
  title,
  initialStatus = 'all',
  initialGroupBy = 'none',
  initialAssigneeId = 'all',
  initialProjectId = 'all',
  tagsProjectId,
  filterScope,
  toolbarLeading,
  viewScope,
  layoutScope = 'all',
  onLoadMore,
  hasMore = false,
  totalCount,
  loadPage,
}: {
  tasks?: BxTask[];
  showProject?: boolean;
  title?: string | null;
  initialStatus?: string;
  initialGroupBy?: GroupBy;
  initialAssigneeId?: string;
  initialProjectId?: string;
  viewScope?: 'all' | 'my';
  layoutScope?: string;
  onLoadMore?: () => Promise<void>;
  hasMore?: boolean;
  totalCount?: number;
  loadPage?: (query: TaskGridPageQuery) => Promise<TaskGridPage>;
  // Список тегов на странице проекта должен быть только его: фильтра проекта
  // там нет, поэтому область берём из пропа.
  tagsProjectId?: string;
  /** Экран, за которым закреплён набор фильтров: доска того же проекта делит его. */
  filterScope?: string;
  // Переключатель вида приходит снаружи и живёт в той же строке панели, что и
  // на доске: иначе при смене режима навбар прыгает на другую высоту.
  toolbarLeading?: ReactNode;
}) {
  const selectedTaskId = useKanbanStore((state) => state.selectedTaskId);
  const setPagedTasks = useKanbanStore((state) => state.setPagedTasks);
  const storedTasks = useKanbanStore((state) => state.allTasks);
  const updateTaskField = useKanbanStore((state) => state.updateTaskField);
  const gridToasts = useTaskToasts();
  const { openTask, closeTask } = useTaskUrl();
  const createTask = useKanbanStore((state) => state.createTask);
  const projects = useKanbanStore((state) => state.projects);
  const users = useKanbanStore((state) => state.users);
  const stages = useKanbanStore((state) => state.stages);
  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  // С loadPage контент всегда приходит с сервера. Раньше состояние стартовало
  // с initialTasks, поэтому при переключении вида список рисовался дважды:
  // сначала обрезанным набором из стора, через ~300мс — серверной страницей.
  const [serverPage, setServerPage] = useState<TaskGridPage>(() =>
    loadPage
      ? { tasks: [], total: totalCount ?? 0 }
      : { tasks: initialTasks, total: totalCount ?? initialTasks.length },
  );
  const [serverPageReady, setServerPageReady] = useState(!loadPage);
  const [isServerPageLoading, setIsServerPageLoading] = useState(false);
  const [serverPageError, setServerPageError] = useState<string | null>(null);
  const [serverPageRetry, setServerPageRetry] = useState(0);
  const loadPageRef = useRef(loadPage);
  useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);
  // Строки серверной страницы подменяем версией из стора: инлайн-правки
  // (дата, исполнитель, приоритет, оценка) обновляют его оптимистично.
  const storedById = useMemo(
    () => new Map(storedTasks.map((task) => [task.id, task])),
    [storedTasks],
  );
  const tasks = loadPage
    ? serverPage.tasks.map((task) => storedById.get(task.id) || task)
    : initialTasks;
  const effectiveTotal = loadPage ? serverPage.total : totalCount;
  // Как на доске: задача, перенесённая в другой проект, уходит из списка, но
  // открытая карточка должна остаться — ищем её и в общем кэше.
  const storedAllTasks = useKanbanStore((state) => state.allTasks);
  const selectedTask = useMemo(
    () =>
      tasks.find((task) => task.id === selectedTaskId) ||
      storedAllTasks.find((task) => task.id === selectedTaskId),
    [tasks, storedAllTasks, selectedTaskId],
  );
  const [page, setPage] = useState(1);
  // Состояние списка живёт и в ссылке (?filters=…&group=…&q=…): отфильтрованный
  // список можно переслать, а значения из ссылки важнее сохранённых.
  const urlParams = useSearchParams();
  const gridPathname = usePathname();
  const [linkState] = useState(() => ({
    filters: decodeFiltersParam(urlParams.get('filters')),
    group: urlParams.get('group') || '',
    query: urlParams.get('q') || '',
  }));
  const [query, setQuery] = useState(linkState.query);
  // Фильтры живут в сторе одним объектом: их делит доска того же проекта,
  // поэтому переключение канбан ⇄ список ничего не сбрасывает.
  const filters = useKanbanStore((state) => state.taskFilters);
  const setFilters = useKanbanStore((state) => state.setTaskFilters);
  const setFilter = useKanbanStore((state) => state.setTaskFilter);
  const enterFilterScope = useKanbanStore((state) => state.enterFilterScope);
  const activeFilterScope = useKanbanStore((state) => state.taskFiltersScope);
  useEffect(() => {
    enterFilterScope(filterScope || layoutScope, {
      ...initialFilterValues(initialStatus, initialAssigneeId, initialProjectId),
      ...linkState.filters,
    });
  }, [
    linkState,
    enterFilterScope,
    filterScope,
    layoutScope,
    initialAssigneeId,
    initialProjectId,
    initialStatus,
  ]);
  const statusFilter = filters.status;
  const hideDone = filters.hideDone === 'on';
  const assigneeFilter = filters.assignee;
  const projectFilter = filters.project;
  const isMobile = useIsMobile();
  const pageSize = isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE;
  const [groupBy, setGroupBy] = useState<GroupBy>(
    isGroupBy(linkState.group) ? linkState.group : initialGroupBy,
  );
  const [activePreset, setActivePreset] = useState('');
  const currentUserId = useKanbanStore((state) => state.currentUser.id);
  const [draftQuery, setDraftQuery] = useState(linkState.query);
  useEffect(() => {
    // Пишем, только когда фильтры экрана уже подняты: иначе первый проход
    // стирал бы из ссылки то, что ещё не успело примениться.
    if (activeFilterScope !== (filterScope || layoutScope)) return;
    const params = new URLSearchParams(window.location.search);
    const encoded = encodeFiltersParam(filters);
    if (encoded) params.set('filters', encoded);
    else params.delete('filters');
    if (groupBy !== 'none') params.set('group', groupBy);
    else params.delete('group');
    if (query) params.set('q', query);
    else params.delete('q');
    // Старые одиночные параметры уже вошли в filters: оставь их — и сброшенный
    // фильтр вернулся бы после перезагрузки.
    for (const legacy of ['status', 'assignee', 'project']) params.delete(legacy);
    const next = params.toString();
    if (next !== window.location.search.replace(/^\?/, ''))
      window.history.replaceState(
        window.history.state,
        '',
        next ? `${gridPathname}?${next}` : gridPathname,
      );
  }, [activeFilterScope, filterScope, filters, gridPathname, groupBy, layoutScope, query]);
  // Искать по Enter неудобно: подхватываем ввод сами, с паузой на дописывание.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draftQuery), 350);
    return () => window.clearTimeout(timer);
  }, [draftQuery]);
  const [availableTags, setAvailableTags] = useState<
    Array<{ tag: string; label: string; count: number }>
  >([]);

  // Панель фильтров общая с доской: переключение вида не схлопывает её.
  const showFilters = useKanbanStore((state) => state.filtersPanelOpen);
  const setShowFilters = useKanbanStore((state) => state.setFiltersPanelOpen);
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
  // На телефоне поля правятся в раскрывающемся блоке карточки: иначе список
  // превращается в простыню контролов.
  const [editingCardIds, setEditingCardIds] = useState<Set<string>>(new Set());
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
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) =>
      value !== EMPTY_FILTERS[key as FilterFieldKey] && (key !== 'project' || showProject),
  ).length;
  const orderedTasks = useMemo(() => {
    if (loadPage) {
      if (groupBy !== 'hierarchy') return tasks;
      // Родители приходят отдельно: они не совпадения фильтра, а ветка к ним.
      return orderTasksAsTree(tasks, [...tasks, ...(serverPage.ancestors || [])]);
    }
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
      if (key === 'tags')
        return (task.tags?.length ? task.tags : extractTaskTags(task.title, task.description)).join(
          ' ',
        );
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
    return orderTasksAsTree(matchingTasks, tasks);
  }, [
    serverPage.ancestors,
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
    loadPage,
  ]);
  const loadedPageCount = Math.max(1, Math.ceil(tasks.length / pageSize));
  const pageCount = loadPage
    ? Math.max(1, Math.ceil(serverPage.total / pageSize))
    : Math.max(1, Math.ceil(orderedTasks.length / pageSize));
  const totalPageCount = effectiveTotal
    ? Math.max(1, Math.ceil(effectiveTotal / pageSize))
    : pageCount;
  const pageStart = (page - 1) * pageSize;
  // Подтянутые родители в счёт страницы не идут: это контекст, а не результат.
  const matchedOnPage = loadPage ? tasks.length : orderedTasks.length;
  const pageTasks = loadPage ? orderedTasks : orderedTasks.slice(pageStart, pageStart + pageSize);
  const loadNextPage = async () => {
    if (loadPage) {
      if (page < pageCount) setPage((value) => value + 1);
      return;
    }
    if (page < pageCount) {
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
  // Родители, дотянутые ради ветки: под фильтр они не подошли, поэтому в списке
  // показываем их приглушённо — как контекст, а не как найденное.
  const contextTaskIds = useMemo(() => {
    if (groupBy !== 'hierarchy') return new Set<string>();
    const matched = new Set(tasks.map((task) => task.id));
    return new Set(orderedTasks.filter((task) => !matched.has(task.id)).map((task) => task.id));
  }, [groupBy, orderedTasks, tasks]);
  const displayPageTasks =
    groupBy === 'hierarchy'
      ? pageTasks.filter((task) => hierarchy.isVisible.get(task.id))
      : pageTasks;
  // Серверная группировка: сервер отдаёт задачи уже подряд по группам и итоги
  // по всему списку, а не по странице. Клиентский вариант остаётся для гридов
  // без loadPage.
  const serverGroups = serverPage.groups;
  const [stageNames, setStageNames] = useState<Record<string, string>>({});
  // Фазы каждого проекта запрашиваем один раз: иначе фаза, которой нет в
  // ответе (удалённая, «0»), перезапускала загрузку по кругу.
  const requestedStageProjectsRef = useRef(new Set<string>());
  useEffect(() => {
    if (groupBy !== 'stage' || !serverGroups?.length) return;
    const known = new Set(stages.map((stage) => String(stage.id)));
    const projectIds = [
      ...new Set(
        serverGroups
          .map((group) => group.key.split('|'))
          .filter(([, stageId]) => stageId && stageId !== '0' && !known.has(stageId))
          .map(([projectId]) => projectId)
          .filter(
            (projectId) =>
              projectId && projectId !== '0' && !requestedStageProjectsRef.current.has(projectId),
          ),
      ),
    ].slice(0, 20);
    if (!projectIds.length) return;
    projectIds.forEach((id) => requestedStageProjectsRef.current.add(id));
    void Promise.all(projectIds.map((id) => fetchProjectStages(id).catch(() => []))).then(
      (lists) => {
        const next: Record<string, string> = {};
        for (const list of lists) for (const stage of list) next[String(stage.id)] = stage.name;
        setStageNames((current) => ({ ...current, ...next }));
      },
    );
  }, [groupBy, serverGroups, stages]);
  const groupedPageTasks = useMemo(() => {
    if (groupBy === 'none' || groupBy === 'hierarchy')
      return [
        {
          key: '',
          label: '',
          tasks: displayPageTasks,
          count: displayPageTasks.length,
          continued: false,
        },
      ];
    if (loadPage && serverGroups) {
      const byKey = new Map(serverGroups.map((group) => [group.key, group]));
      // Где начинается группа в общем списке — чтобы пометить «продолжение»,
      // если она началась на прошлой странице.
      const startOf = new Map<string, number>();
      let offset = 0;
      for (const group of serverGroups) {
        startOf.set(group.key, offset);
        offset += group.count;
      }
      const stageLabel = (key: string, projectLabel: string) => {
        const stageId = key.split('|')[1] || '';
        const name =
          stages.find((stage) => String(stage.id) === stageId)?.name || stageNames[stageId];
        const stageText = stageId === '0' || !stageId ? 'Без фазы' : name || 'Фаза';
        return showProject ? `${projectLabel} · ${stageText}` : stageText;
      };
      const result: Array<{
        key: string;
        label: string;
        tasks: BxTask[];
        count: number;
        continued: boolean;
      }> = [];
      for (const task of displayPageTasks) {
        const key = task.groupKey ?? '';
        const last = result[result.length - 1];
        if (last && last.key === key) {
          last.tasks.push(task);
          continue;
        }
        const group = byKey.get(key);
        const label = group?.label || '—';
        result.push({
          key,
          label: groupBy === 'stage' ? stageLabel(key, label) : label,
          tasks: [task],
          count: group?.count ?? 1,
          continued: (startOf.get(key) ?? pageStart) < pageStart,
        });
      }
      return result;
    }
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
      count: groupedTasks.length,
      continued: false,
    }));
  }, [
    displayPageTasks,
    groupBy,
    loadPage,
    pageStart,
    serverGroups,
    showProject,
    stageNames,
    stages,
    users,
  ]);
  // Свёрнутые группы: заголовок — кнопка, строки прячутся.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const groupHeader = (group: {
    key: string;
    label: string;
    count: number;
    continued: boolean;
  }) => (
    <button
      type="button"
      onClick={() => toggleGroup(group.key)}
      aria-expanded={!collapsedGroups.has(group.key)}
      className="flex w-full items-center gap-1.5 text-left font-medium text-ink"
    >
      {collapsedGroups.has(group.key) ? (
        <ChevronRight className="size-4 shrink-0" strokeWidth={1.7} />
      ) : (
        <ChevronDown className="size-4 shrink-0" strokeWidth={1.7} />
      )}
      <span className="truncate">{group.label}</span>
      <span className="shrink-0 font-normal tabular-nums text-ink-faint">{group.count}</span>
      {group.continued && (
        <span className="shrink-0 font-normal text-ink-faint">· продолжение</span>
      )}
    </button>
  );
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
    hasNarrowingFilter && orderedTasks.length < pageSize
      ? 'max-h-none'
      : showProject || layoutScope === 'projects'
        ? 'max-h-[calc(100dvh-17rem)]'
        : 'max-h-[calc(100dvh-28rem)]';
  const tableScrollClass =
    tableHeightClass === 'max-h-none' ? 'overflow-x-auto' : 'overflow-auto overscroll-contain';
  const visiblePageCount = loadPage
    ? totalPageCount
    : !hasNarrowingFilter && totalCount
      ? totalPageCount
      : pageCount;
  const pageNumbers = Array.from(
    new Set(
      [1, page - 1, page, page + 1, visiblePageCount].filter(
        (value) => value >= 1 && value <= visiblePageCount,
      ),
    ),
  ).sort((left, right) => left - right);
  const goToPage = (nextPage: number) => {
    if (loadPage && nextPage <= pageCount) {
      setPage(nextPage);
      return;
    }
    if (nextPage <= pageCount) {
      setPage(nextPage);
      return;
    }
    if (nextPage === page + 1) void loadNextPage();
  };

  // Только на смену начальных значений из URL. Раньше эти эффекты срабатывали
  // и при монтировании, поэтому переключение доска → список стирало фильтр,
  // набранный на доске.
  const initialFromUrl = useRef({ assignee: initialAssigneeId, project: initialProjectId });
  useEffect(() => {
    if (initialFromUrl.current.assignee !== initialAssigneeId) {
      initialFromUrl.current.assignee = initialAssigneeId;
      setFilter('assignee', initialAssigneeId);
    }
    if (initialFromUrl.current.project !== initialProjectId) {
      initialFromUrl.current.project = initialProjectId;
      setFilter('project', initialProjectId);
    }
  }, [initialAssigneeId, initialProjectId, setFilter]);

  // Теги подтягиваем под текущую область: проект страницы либо выбранный
  // в фильтре проект, иначе все доступные задачи.
  const tagScope = tagsProjectId || (showProject ? projectFilter : 'all');
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/tasks/tags?projectId=${encodeURIComponent(tagScope)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setAvailableTags(Array.isArray(data.tags) ? data.tags : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tagScope]);

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
          setColumnWidths({ ...COLUMN_WIDTHS, ...data.preference.columnWidths });
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
        body: JSON.stringify({
          scope: layoutScope,
          config: { visibleColumns, columnWidths: customColumnWidths(columnWidths) },
        }),
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [columnWidths, layoutDirty, layoutScope, loadedLayoutScope, visibleColumns]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [filters, groupBy, pageSize, query, sorts]);
  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, pageCount));
  }, [pageCount]);
  useEffect(() => {
    setCollapsedTaskIds(new Set());
  }, [groupBy]);

  // Раньше одна и та же страница уходила 2–3 раза: эффект перезапускался на
  // новой ссылке на filters/sorts с теми же значениями, а на телефоне первый
  // запрос шёл с размером страницы десктопа, пока useIsMobile не ответил.
  // Теперь запрос откладывается на тик (схлопывает первые рендеры) и не
  // повторяется с тем же ключом; ответ применяется по номеру запроса.
  const lastPageKeyRef = useRef('');
  const pageRequestIdRef = useRef(0);
  useEffect(() => {
    if (!loadPageRef.current) return;
    const request = {
      page,
      query,
      limit: pageSize,
      sorts,
      filters: { ...filters, project: showProject ? filters.project : 'all' },
      hierarchy: groupBy === 'hierarchy',
      groupBy: groupBy === 'hierarchy' ? 'none' : groupBy,
    };
    const key = JSON.stringify([request, serverPageRetry]);
    if (key === lastPageKeyRef.current) return;
    const timer = window.setTimeout(() => {
      const load = loadPageRef.current;
      if (!load) return;
      lastPageKeyRef.current = key;
      const requestId = ++pageRequestIdRef.current;
      const isCurrent = () => requestId === pageRequestIdRef.current;
      setIsServerPageLoading(true);
      setServerPageError(null);
      void load(request)
        .then((nextPage) => {
          if (!isCurrent()) return;
          setServerPage(nextPage);
          setServerPageReady(true);
          setPagedTasks(nextPage.tasks, nextPage.total);
        })
        .catch(() => {
          if (!isCurrent()) return;
          // Ошибка не должна запоминать ключ, иначе «Повторить» с теми же
          // параметрами не сработает.
          lastPageKeyRef.current = '';
          setServerPageError('Не удалось загрузить страницу. Повторите попытку.');
          setServerPageReady(true);
        })
        .finally(() => {
          if (isCurrent()) setIsServerPageLoading(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [filters, groupBy, pageSize, page, query, serverPageRetry, setPagedTasks, showProject, sorts]);

  const resetFilters = () => {
    if (isMobile) setShowFilters(false);
    setQuery('');
    setDraftQuery('');
    setFilters(EMPTY_FILTERS);
    setActivePreset('');
  };
  const applyView = (id: string) => {
    if (id === 'default') {
      setActiveViewId('');
      setFilters(initialFilterValues(initialStatus, 'all', 'all'));
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
    setFilters({ ...EMPTY_FILTERS, ...config.filters });
    // Иначе применённое вью видно только по счётчику у свёрнутой панели.
    setShowFilters(true);
    setGroupBy(config.groupBy);
    setSorts(config.sorts);
    setVisibleColumns(normalizeVisibleColumns(config.visibleColumns));
    setColumnWidths({ ...COLUMN_WIDTHS, ...config.columnWidths });
    setLayoutDirty(false);
  };
  const saveView = async () => {
    const name = viewName.trim();
    if (!name || !viewScope) return;
    const config = {
      filters,
      groupBy,
      sorts,
      visibleColumns,
      columnWidths: customColumnWidths(columnWidths),
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelectedIds((current) =>
      pageTasks.every((task) => current.has(task.id))
        ? new Set([...current].filter((id) => !pageTasks.some((task) => task.id === id)))
        : new Set([...current, ...pageTasks.map((task) => task.id)]),
    );
  // Выгрузка того, что сейчас на экране: колонки берём видимые, значения —
  // человекочитаемые, чтобы файл можно было открыть и сразу отправить.
  const exportCsv = () => {
    const rows = selectedIds.size
      ? displayPageTasks.filter((task) => selectedIds.has(task.id))
      : displayPageTasks;
    if (!rows.length) {
      gridToasts.failed('Нечего выгружать', new Error('В списке нет задач'));
      return;
    }
    const columns = orderedVisibleColumns;
    const value = (task: BxTask, column: ColumnKey) => {
      if (column === 'title') return task.title;
      if (column === 'project') return projectById[task.projectId]?.name || '';
      if (column === 'stage') return stages.find((stage) => stage.id === task.stageId)?.name || '';
      if (column === 'assignee') return task.assigneeName || '';
      if (column === 'priority') return PRIORITY_LABELS[task.priority]?.label || '';
      if (column === 'deadline') return task.dueDate || '';
      if (column === 'estimate') return String(task.estimate ?? '');
      if (column === 'actual') return String(task.actualTime ?? '');
      if (column === 'updated') return task.updatedDate || '';
      if (column === 'created') return task.createdDate || '';
      if (column === 'description') return task.description || '';
      if (column === 'comments') return String(task.commentsCount ?? 0);
      if (column === 'parent') return task.parentId || '';
      if (column === 'tags') return (task.tags || []).join(' ');
      return '';
    };
    const escape = (text: string) => `"${text.replaceAll('"', '""').replaceAll('\n', ' ')}"`;
    const csv = [
      ['ID', ...columns.map((column) => COLUMN_LABELS[column])].map(escape).join(';'),
      ...rows.map((task) =>
        [task.id, ...columns.map((column) => value(task, column))].map(escape).join(';'),
      ),
    ].join('\r\n');
    // BOM: иначе Excel открывает кириллицу кракозябрами.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    gridToasts.saved(`Выгружено задач: ${rows.length}`);
  };

  const applyBulk = (field: 'assigneeId' | 'status', value: string) => {
    // Запоминаем прежние значения: применить статус к двадцати задачам легко,
    // а вот вернуть всё обратно вручную — нет.
    const affected = [...selectedIds]
      .map((id) => tasks.find((task) => task.id === id))
      .filter((task): task is BxTask => Boolean(task))
      .map((task) => ({
        id: task.id,
        previous: field === 'status' ? task.status : task.assigneeId || '',
      }));
    setSelectedIds(new Set());
    void Promise.all(affected.map(({ id }) => updateTaskField(id, field, value)))
      .then(() =>
        gridToasts.undoable(`Изменено задач: ${affected.length}`, () =>
          Promise.all(
            affected.map(({ id, previous }) => updateTaskField(id, field, previous)),
          ).then(() => undefined),
        ),
      )
      .catch((error) => gridToasts.failed('Массовое изменение не прошло', error));
  };
  // Клик — сортировка только по этой колонке (↑ → ↓ → снять), Shift+клик —
  // добавить её следующим уровнем. Раньше любой клик молча добавлял колонку
  // в начало, и прежние сортировки незаметно оставались вторыми.
  const toggleSort = (key: SortKey, additive = false) => {
    setSorts((current) => {
      const currentSort = current.find((sort) => sort.key === key);
      const direction: Sort['direction'] | null = !currentSort
        ? 'asc'
        : currentSort.direction === 'asc'
          ? 'desc'
          : null;
      if (!additive) return direction ? [{ key, direction }] : [];
      if (!direction) return current.filter((sort) => sort.key !== key);
      return currentSort
        ? current.map((sort) => (sort.key === key ? { key, direction } : sort))
        : [...current, { key, direction }];
    });
  };
  // Номер уровня сортировки: при нескольких уровнях он показывает, в каком
  // порядке применены колонки.
  const sortLabel = (key: SortKey) => {
    const index = sorts.findIndex((sort) => sort.key === key);
    return index < 0 ? '' : sorts.length > 1 ? String(index + 1) : '';
  };
  const sortDirection = (key: SortKey) => sorts.find((sort) => sort.key === key)?.direction;
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
  const sortableHead = (key: SortKey, label: string) => {
    const direction = sortDirection(key);
    return (
      <GridHead
        key={key}
        className="relative p-0"
        style={{ width: columnWidths[key] }}
        ariaSort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          onClick={(event) => toggleSort(key, event.shiftKey)}
          title="Сортировать. Shift+клик — добавить вторым уровнем"
          className="flex h-8 w-full items-center gap-1 px-2 text-left text-whisper font-bold uppercase tracking-widest text-ink-faint transition-colors duration-fast hover:text-ink"
        >
          <span className="truncate">{label}</span>
          {/* Треугольник набора: видно, что колонка сортируется, даже по цвету. */}
          <svg
            className={cn(
              'h-3 w-3 shrink-0',
              direction ? 'opacity-100' : 'opacity-30',
              direction === 'desc' && '-rotate-180',
            )}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m6 14 6-6 6 6"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {sortLabel(key) ? (
            <span className="text-[10px] tabular-nums">{sortLabel(key)}</span>
          ) : null}
        </button>
        <span
          role="separator"
          aria-label={`Изменить ширину столбца ${label}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            resizeColumn(key, event.clientX, columnWidths[key]);
          }}
          className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-ink"
        />
      </GridHead>
    );
  };

  const isReadOnly = showProject;
  // Поля конструктора описываем ровно теми значениями, которые понимает
  // /api/tasks/all: иначе фильтр обещал бы то, чего сервер не умеет.
  const filterFields: FilterField[] = taskFilterFields({
    users,
    tags: availableTags,
    statusLabels: STATUS_LABELS,
    projects: showProject ? [{ id: NO_PROJECT_ID, name: NO_PROJECT_NAME }, ...projects] : undefined,
    stages,
  });

  const filterValues: FilterValues = filters;

  const setFilterValue = (key: FilterFieldKey, value: string) => {
    setActivePreset('');
    setFilter(key, value);
  };

  // Шорткаты: то, что спрашивают каждый день, одним нажатием.
  const filterPresets = taskFilterPresets(currentUserId);

  const applyPreset = (preset: FilterPreset) => {
    const next = activePreset === preset.id ? null : preset;
    setActivePreset(next ? next.id : '');
    setFilters({ ...EMPTY_FILTERS, ...(next?.values ?? {}) });
  };

  const filterControls = (
    <TaskFilterBar
      fields={filterFields}
      values={filterValues}
      presets={filterPresets}
      activePreset={activePreset}
      onChange={setFilterValue}
      onApplyPreset={applyPreset}
      onReset={resetFilters}
      stacked={isMobile}
    />
  );

  return (
    <>
      {/* Панель и содержимое тянутся во всю ширину, как у доски: раньше
          карточка отступала на 24px и рамка панели не доходила до края. */}
      <Card
        padding="none"
        className="w-full min-w-0 gap-2 rounded-none border-0 bg-transparent py-0 shadow-none"
      >
        {/* Те же отступы, что у панели доски, иначе при переключении вида
              навбар перескакивает на другую высоту. */}
        <div className="sticky top-0 z-10 gap-2 rounded-none border-0 border-b border-line bg-canvas px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {toolbarLeading}
            {title !== null && (
              <h2 className="shrink-0 text-base font-bold tracking-tight text-ink">
                {title ?? 'Задачи проекта'}
              </h2>
            )}
            {viewScope && (
              <Menu
                label="Вид"
                align="start"
                items={[
                  { label: 'По умолчанию', onSelect: () => applyView('default') },
                  ...views.map((view) => ({
                    label: view.name,
                    onSelect: () => applyView(view.id),
                  })),
                  { label: '', separator: true },
                  { label: 'Сохранить текущий вид', onSelect: () => setSaveViewOpen(true) },
                ]}
                trigger={
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`${toolbarControl} aria-expanded:bg-surface aria-expanded:text-ink`}
                    icon={<Bookmark size={14} strokeWidth={1.7} />}
                  >
                    {/* Раньше тут было голое «По умолчанию» — не догадаться, что это
                        меню сохранённых видов. */}
                    Вид: {views.find((view) => view.id === activeViewId)?.name || 'по умолчанию'}
                  </Button>
                }
              />
            )}
            <TextField
              type="search"
              variant="boxed"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setQuery(draftQuery);
              }}
              placeholder="Поиск задач…"
              aria-label="Поиск задач"
              // На телефоне поиск — первая строка панели, а не третья после вида.
              className={`${toolbarControl} w-full max-sm:order-first sm:w-56 lg:w-auto lg:min-w-72 lg:flex-1 xl:max-w-[32rem] [&_input]:h-full`}
            />
            <Button
              variant="secondary"
              size="sm"
              className={toolbarControl}
              onClick={exportCsv}
              title="Выгрузить в CSV то, что сейчас в списке"
              icon={<Download size={14} strokeWidth={1.7} />}
            >
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <Popover
              placement="bottom"
              trigger={
                <Button variant="secondary" size="sm" className={toolbarControl}>
                  Поля
                </Button>
              }
            >
              <div className="w-full">
                <p className="px-1 py-1 text-xs font-bold uppercase tracking-widest text-ink-faint">
                  Перетащите, чтобы изменить порядок
                </p>
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
                {hiddenColumns.length > 0 && <Separator className="my-1" />}
                {hiddenColumns.map((column) => (
                  <label
                    key={column}
                    className="flex min-h-8 cursor-pointer items-center gap-2 rounded-ui px-1 text-sm text-ink-soft hover:text-ink"
                  >
                    <Checkbox
                      checked={false}
                      onChange={(event) => toggleColumn(column, event.currentTarget.checked)}
                      ariaLabel={COLUMN_LABELS[column]}
                    />
                    <span className="min-w-0 flex-1 truncate">{COLUMN_LABELS[column]}</span>
                  </label>
                ))}
              </div>
            </Popover>
            <SelectField
              size="sm"
              variant="boxed"
              aria-label="Группировка"
              value={groupBy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isGroupBy(value)) setGroupBy(value);
              }}
              /* По проекту — только там, где в списке несколько проектов. */
              options={GROUP_BY_OPTIONS.filter(
                (option) => showProject || option.value !== 'project',
              )}
              className={`${toolbarSelect} w-40 [&_select]:h-full`}
            />
            {/* Сортировка живёт в заголовках таблицы, а на телефоне её нет */}
            <SelectField
              size="sm"
              variant="boxed"
              aria-label="Сортировка"
              value={`${sorts[0]?.key || 'updated'}:${sorts[0]?.direction || 'desc'}`}
              onChange={(event) => {
                const [key, direction] = event.currentTarget.value.split(':');
                setSorts([{ key: key as SortKey, direction: direction as Sort['direction'] }]);
              }}
              options={(Object.keys(COLUMN_LABELS) as ColumnKey[]).flatMap((column) => [
                { value: `${column}:desc`, label: `${COLUMN_LABELS[column]} ↓` },
                { value: `${column}:asc`, label: `${COLUMN_LABELS[column]} ↑` },
              ])}
              className={`${toolbarSelect} w-48 md:hidden [&_select]:h-full`}
            />
            {/* Закрытые задачи в ежедневном списке мешают: переключатель всегда на
                виду, а не последним пунктом в меню «+ Фильтр». */}
            <Button
              variant={hideDone ? 'primary' : 'secondary'}
              size="sm"
              className={toolbarControl}
              aria-pressed={hideDone}
              onClick={() => setFilterValue('hideDone', hideDone ? 'off' : 'on')}
              icon={<CheckCheck size={14} strokeWidth={1.7} />}
            >
              {/* Одним текстом: два соседних flex-элемента получали gap, и между
                  словами был двойной пробел. */}
              <span className="sm:hidden">Активные</span>
              <span className="hidden sm:inline">Только активные</span>
            </Button>
            <Button
              variant={showFilters || activeFilterCount > 0 ? 'primary' : 'secondary'}
              size="sm"
              className={toolbarControl}
              onClick={() => setShowFilters(!showFilters)}
              icon={<Filter size={14} strokeWidth={1.7} />}
            >
              Фильтры
              {activeFilterCount > 0 && <Badge tone="neutral">{activeFilterCount}</Badge>}
            </Button>
            {showFilters && (
              <div className={`hidden md:flex ${toolbarPanel}`}>{filterControls}</div>
            )}
          </div>
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-ui border border-line bg-surface p-2 text-sm">
              <span className="font-medium text-ink">Выбрано: {selectedIds.size}</span>
              <Button
                variant="secondary"
                size="sm"
                className={toolbarControl}
                onClick={exportCsv}
                icon={<Download size={14} strokeWidth={1.7} />}
              >
                Выгрузить CSV
              </Button>
              <SelectField
                size="sm"
                variant="boxed"
                aria-label="Назначить исполнителя"
                value=""
                placeholder="Назначить…"
                onChange={(event) => {
                  if (event.currentTarget.value) applyBulk('assigneeId', event.currentTarget.value);
                }}
                options={users.map((user) => ({ value: user.id, label: user.name }))}
                className={`${toolbarSelect} w-44 [&_select]:h-full`}
              />
              <SelectField
                size="sm"
                variant="boxed"
                aria-label="Сменить статус"
                value=""
                placeholder="Сменить статус…"
                onChange={(event) => {
                  if (event.currentTarget.value) applyBulk('status', event.currentTarget.value);
                }}
                options={[
                  { value: 'new', label: 'Новая' },
                  { value: 'in_progress', label: 'В работе' },
                  { value: 'done', label: 'Готово' },
                ]}
                className={`${toolbarSelect} w-40 [&_select]:h-full`}
              />
              <Button variant="quiet" size="sm" onClick={() => setSelectedIds(new Set())}>
                Снять выбор
              </Button>
            </div>
          )}
        </div>
        <div className="min-h-72 p-0">
          {!serverPageReady && !serverPageError && (
            <LoadingState className="min-h-72 bg-transparent" />
          )}
          {serverPageReady && tasks.length === 0 && !serverPageError && (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
              <div className="rounded-full bg-surface-2 p-3 text-ink-faint">
                <Circle size={24} strokeWidth={1.7} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-ink">Нет задач</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {activeFilterCount > 0 || query
                    ? 'По выбранным фильтрам ничего не найдено.'
                    : 'Здесь пока пусто — создайте первую задачу.'}
                </p>
                {/* Пустой экран без действия — тупик: даём выход прямо отсюда. */}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {(activeFilterCount > 0 || query) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={resetFilters}
                      icon={<Filter size={14} strokeWidth={1.7} />}
                    >
                      Сбросить фильтры
                    </Button>
                  )}
                  <QuickCreateTask defaultProjectId={tagsProjectId} />
                </div>
              </div>
            </div>
          )}
          {serverPageError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-2 text-sm text-danger-text sm:px-6"
            >
              {serverPageError}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setServerPageRetry((value) => value + 1)}
              >
                Повторить
              </Button>
            </div>
          )}
          {/* Раньше обе разметки жили в DOM одновременно: 50 строк таблицы плюс
              50 карточек — вдвое больше узлов и работы на каждый рендер. */}
          {isMobile && serverPageReady && tasks.length > 0 && (
            <div className="divide-y px-4 sm:px-6">
              {groupedPageTasks
                .flatMap((group) => [
                  ...(groupBy !== 'none' && groupBy !== 'hierarchy'
                    ? [
                        <div
                          key={`group:${group.key}`}
                          className="-mx-4 bg-surface-2 px-4 py-2 text-sm sm:-mx-6 sm:px-6"
                        >
                          {groupHeader(group)}
                        </div>,
                      ]
                    : []),
                  ...(collapsedGroups.has(group.key) ? [] : group.tasks),
                ])
                .map((item) => {
                  // Заголовок группы уже готовый элемент, остальное — задачи.
                  if (isValidElement(item)) return item;
                  const task = item as BxTask;
                  const assignee =
                    task.assigneeName ||
                    users.find((user) => user.id === task.assigneeId)?.name ||
                    'Не назначен';
                  const priority = PRIORITY_LABELS[task.priority]?.label || 'Обычный';
                  return (
                    <article
                      key={task.id}
                      // Уровень вложенности на телефоне — отступом: кнопки
                      // сворачивания в карточке нет, а понять глубину надо.
                      style={
                        groupBy === 'hierarchy'
                          ? {
                              paddingLeft: `calc(1rem + ${(hierarchy.depthById.get(task.id) || 0) * 14}px)`,
                            }
                          : undefined
                      }
                      className={`max-w-full min-w-0 overflow-hidden p-4 ${
                        contextTaskIds.has(task.id) ? 'opacity-60' : ''
                      } ${
                        task.status === 'done'
                          ? 'bg-surface-2 text-ink-faint'
                          : needsDeadlineAttention(task)
                            ? 'bg-warning/10'
                            : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {/* Галка обычного размера, но область касания — 40px:
                        padding даёт обёртка, иначе раздувается сама рамка. */}
                        <span
                          className="-m-2.5 shrink-0 p-2.5"
                          onClick={(event) => {
                            if (event.target === event.currentTarget) toggleSelected(task.id);
                          }}
                        >
                          <Checkbox
                            checked={selectedIds.has(task.id)}
                            onChange={() => toggleSelected(task.id)}
                            ariaLabel={`Выбрать задачу ${task.title}`}
                            className="mt-0.5"
                          />
                        </span>
                        {groupBy === 'hierarchy' &&
                          (hierarchy.childCount.get(task.id) || 0) > 0 && (
                            <span className="mt-0.5 shrink-0">
                              <IconButton
                                variant="ghost"
                                size="sm"
                                className="size-6"
                                label={
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
                                  <ChevronRight size={16} strokeWidth={1.7} />
                                ) : (
                                  <ChevronDown size={16} strokeWidth={1.7} />
                                )}
                              </IconButton>
                            </span>
                          )}
                        <button
                          type="button"
                          onClick={() => openTask(task.id)}
                          className="min-w-0 flex-1 text-left"
                          style={{
                            paddingLeft:
                              groupBy === 'hierarchy'
                                ? `${(hierarchy.depthById.get(task.id) || 0) * 16}px`
                                : undefined,
                          }}
                        >
                          <div className="flex items-start gap-2">
                            {task.status === 'done' ? (
                              <CheckCircle2
                                className="mt-0.5 size-4 shrink-0 text-success-text"
                                strokeWidth={1.7}
                              />
                            ) : (
                              <Circle className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
                            )}
                            <p className="line-clamp-2 text-sm font-medium">
                              {groupBy === 'hierarchy' &&
                                (hierarchy.depthById.get(task.id) || 0) > 0 &&
                                '↳ '}
                              {task.title}
                            </p>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone="neutral">
                              {STATUS_LABELS[task.status] || task.status}
                            </Badge>
                            {task.priority !== 'medium' && <Badge tone="warning">{priority}</Badge>}
                            {/* Пока список проектов не пришёл, лучше промолчать,
                              чем показывать «Проект 95» вместо названия. */}
                            {showProject &&
                              task.projectId &&
                              task.projectId !== '0' &&
                              projectById[task.projectId]?.name && (
                                <span className="inline-flex min-w-0 items-center gap-1 text-xs text-ink-soft">
                                  <Folder className="size-3 shrink-0" />
                                  <span
                                    className="truncate"
                                    title={projectById[task.projectId]?.name}
                                  >
                                    {projectById[task.projectId]?.name}
                                  </span>
                                </span>
                              )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                            <span className="inline-flex items-center gap-1">
                              <User className="size-3 shrink-0" />
                              {assignee}
                            </span>
                            {!task.dueDate && task.status !== 'done' && (
                              <span className="inline-flex items-center gap-1 font-medium text-accent-text">
                                <CalendarDays className="size-3 shrink-0" />
                                без срока
                              </span>
                            )}
                            {task.dueDate && (
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  needsDeadlineAttention(task)
                                    ? 'font-medium text-warning-text'
                                    : ''
                                }`}
                              >
                                <CalendarDays className="size-3 shrink-0" />
                                {formatBitrixDateTime(task.dueDate)}
                              </span>
                            )}
                            {Boolean(task.estimate || task.actualTime) && (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="size-3 shrink-0" />
                                {task.actualTime || 0} / {task.estimate || 0} ч
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center [&_button]:size-11">
                          <IconButton
                            variant="ghost"
                            size="md"
                            label={
                              editingCardIds.has(task.id)
                                ? `Скрыть поля задачи ${task.title}`
                                : `Изменить поля задачи ${task.title}`
                            }
                            onClick={() =>
                              setEditingCardIds((ids) => {
                                const next = new Set(ids);
                                if (next.has(task.id)) next.delete(task.id);
                                else next.add(task.id);
                                return next;
                              })
                            }
                          >
                            <Pencil size={16} strokeWidth={1.7} />
                          </IconButton>
                          <TaskActions task={task} compact />
                        </div>
                      </div>
                      {editingCardIds.has(task.id) && (
                        <div className="mt-3 rounded-ui border border-line bg-surface-2/30 p-3">
                          <FieldControls task={task} compact />
                        </div>
                      )}
                    </article>
                  );
                })}
            </div>
          )}
          {!isMobile && serverPageReady && tasks.length > 0 && (
            <div className={`px-4 sm:px-6 ${tableScrollClass} ${tableHeightClass}`}>
              <table className="w-full min-w-max table-fixed border-collapse text-left text-sm text-ink">
                <colgroup>
                  <col className="w-10" />
                  {orderedVisibleColumns.map((column) => (
                    <col key={column} style={{ width: columnWidths[column] }} />
                  ))}
                  <col className="w-20" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-canvas">
                  <tr className="border-b border-line">
                    <GridHead className="w-10 px-2 py-1.5">
                      <Checkbox
                        checked={
                          pageTasks.length > 0 &&
                          pageTasks.every((task) => selectedIds.has(task.id))
                        }
                        onChange={togglePage}
                        ariaLabel="Выбрать задачи на странице"
                      />
                    </GridHead>
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
                    <GridHead className="w-20 px-2 py-1.5">
                      <span className="sr-only">Действия</span>
                    </GridHead>
                  </tr>
                </thead>
                <tbody>
                  {groupedPageTasks.map((group) => (
                    <Fragment key={`${groupBy}:${group.key || 'all'}`}>
                      {groupBy !== 'none' && groupBy !== 'hierarchy' && (
                        <tr className="bg-surface-2 hover:bg-surface-2">
                          <td
                            colSpan={tableColumnCount}
                            className="border-b border-line px-2 py-1 text-sm font-medium text-ink"
                          >
                            {groupHeader(group)}
                          </td>
                        </tr>
                      )}
                      {(collapsedGroups.has(group.key) ? [] : group.tasks).map((task) => (
                        <tr
                          key={task.id}
                          // content-visibility даёт браузеру пропускать отрисовку
                          // строк за экраном: без него наведение на строку
                          // перекрашивало всю таблицу (~200мс на событие).
                          className={`[content-visibility:auto] [contain-intrinsic-size:auto_44px] hover:bg-surface ${
                            contextTaskIds.has(task.id) ? 'opacity-60' : ''
                          } ${
                            task.status === 'done'
                              ? 'bg-surface-2 text-ink-faint'
                              : needsDeadlineAttention(task)
                                ? 'bg-warning/10 hover:bg-warning/15'
                                : ''
                          }`}
                        >
                          <GridCell>
                            <Checkbox
                              checked={selectedIds.has(task.id)}
                              onChange={() => toggleSelected(task.id)}
                              ariaLabel={`Выбрать задачу ${task.title}`}
                            />
                          </GridCell>
                          {orderedVisibleColumns.map((column) => {
                            if (column === 'title') {
                              return (
                                <GridCell key={column}>
                                  <EditableTitle
                                    task={task}
                                    tree={
                                      groupBy === 'hierarchy'
                                        ? {
                                            depth: hierarchy.depthById.get(task.id) || 0,
                                            hasChildren:
                                              (hierarchy.childCount.get(task.id) || 0) > 0,
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
                                </GridCell>
                              );
                            }
                            if (column === 'project') {
                              return (
                                <GridCell key={column}>
                                  <ProjectField task={task} readOnly={false} />
                                </GridCell>
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
                                <GridCell key={column} className="tabular-nums text-ink-faint">
                                  {task.actualTime || 0}
                                </GridCell>
                              );
                            }
                            if (column === 'description') {
                              return (
                                <GridCell
                                  key={column}
                                  className="max-w-64 truncate text-ink-faint"
                                  title={task.description || undefined}
                                >
                                  {task.description || '—'}
                                </GridCell>
                              );
                            }
                            if (column === 'created' || column === 'updated') {
                              return (
                                <GridCell key={column} className="text-ink-faint">
                                  {formatBitrixDateTime(
                                    column === 'created' ? task.createdDate : task.updatedDate,
                                  )}
                                </GridCell>
                              );
                            }
                            if (column === 'comments') {
                              return (
                                <GridCell key={column} className="text-ink-faint">
                                  {task.commentsCount ?? task.comments.length}
                                </GridCell>
                              );
                            }
                            if (column === 'parent') {
                              return (
                                <GridCell key={column} className="text-ink-faint">
                                  {task.parentId ? `#${task.parentId}` : '—'}
                                </GridCell>
                              );
                            }
                            if (column === 'storyPoints') {
                              return (
                                <GridCell key={column} className="text-ink-faint">
                                  {task.storyPoints ?? '—'}
                                </GridCell>
                              );
                            }
                            return (
                              <GridCell key={column}>
                                <TaskTags task={task} />
                              </GridCell>
                            );
                          })}
                          <GridCell>
                            <TaskActions task={task} />
                          </GridCell>
                        </tr>
                      ))}
                      {groupBy === 'stage' && !showProject && group.key !== '0' && (
                        <tr>
                          <td
                            colSpan={tableColumnCount}
                            className="border-b border-line px-2 py-1.5"
                          >
                            {addingStageId === group.key ? (
                              <TextField
                                autoFocus
                                value={newTaskTitle}
                                onChange={(event) => setNewTaskTitle(event.target.value)}
                                onBlur={() => {
                                  setAddingStageId(null);
                                  setNewTaskTitle('');
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' && newTaskTitle.trim()) {
                                    // Битрикс отклоняет задачу без исполнителя; диалоговое
                                    // создание подставляет currentUser сам, а эта строка нет.
                                    createTask({
                                      title: newTaskTitle.trim(),
                                      responsibleId: currentUserId,
                                      stageId: group.key,
                                    }).catch((error) =>
                                      gridToasts.failed('Задачу не создали', error),
                                    );
                                    setNewTaskTitle('');
                                    setAddingStageId(null);
                                  }
                                  if (event.key === 'Escape') {
                                    setAddingStageId(null);
                                    setNewTaskTitle('');
                                  }
                                }}
                                placeholder="Название новой задачи"
                                aria-label="Название новой задачи"
                                size="sm"
                                variant="underline"
                                className="w-full max-w-md"
                              />
                            ) : (
                              <Button
                                variant="quiet"
                                size="sm"
                                className="text-ink-faint"
                                onClick={() => setAddingStageId(group.key)}
                              >
                                + Добавить задачу
                              </Button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {(pageCount > 1 || hasMore) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
            <p className="text-sm text-ink-soft">
              {/* Считаем только совпадения: в иерархии к ним добавляются
                  родители-контекст, и «1–52 из 2045» вводило в заблуждение. */}
              {matchedOnPage ? pageStart + 1 : 0}–
              {loadPage ? pageStart + matchedOnPage : Math.min(pageStart + pageSize, matchedOnPage)}{' '}
              из {effectiveTotal || tasks.length}
              {effectiveTotal ? `, страница ${page} из ${totalPageCount}` : ''}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-1" aria-label="Пагинация">
              <Button
                variant="secondary"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setPage(1)}
                disabled={isServerPageLoading || page === 1}
              >
                Первая
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((value) => value - 1)}
                disabled={isServerPageLoading || page === 1}
              >
                Назад
              </Button>
              {pageNumbers.map((number) => (
                <Button
                  key={number}
                  variant={number === page ? 'primary' : 'secondary'}
                  size="sm"
                  className="w-9 px-0"
                  onClick={() => goToPage(number)}
                  disabled={
                    isServerPageLoading ||
                    (!loadPage && number > loadedPageCount && number !== page + 1)
                  }
                >
                  {number}
                </Button>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadNextPage()}
                disabled={isServerPageLoading || (page >= pageCount && !hasMore)}
              >
                Вперёд
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setPage(pageCount)}
                disabled={isServerPageLoading || hasMore || page === pageCount}
              >
                Последняя
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Modal
        open={saveViewOpen}
        onClose={() => setSaveViewOpen(false)}
        title="Сохранить представление"
        size="sm"
        footer={
          <Button onClick={() => void saveView()} disabled={!viewName.trim()}>
            Сохранить
          </Button>
        }
      >
        <TextField
          value={viewName}
          onChange={(event) => setViewName(event.target.value)}
          placeholder="Название вида"
          aria-label="Название вида"
          autoFocus
          onKeyDown={(event) => event.key === 'Enter' && void saveView()}
          size="md"
          variant="boxed"
        />
      </Modal>
      {selectedTask && <TaskModal task={selectedTask} onClose={closeTask} />}
      {/* Фильтры на телефоне: панель занимала пол-экрана над списком.
          Только при isMobile — иначе оверлей шторки перехватывает клики по
          инлайн-панели на десктопе. */}
      {isMobile && (
        <Drawer
          open={showFilters}
          onClose={() => setShowFilters(false)}
          side="left"
          title="Фильтры"
        >
          <div className="flex flex-col gap-3">{filterControls}</div>
        </Drawer>
      )}
    </>
  );
}

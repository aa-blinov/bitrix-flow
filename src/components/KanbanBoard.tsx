'use client';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { PRIORITY_LABELS, STATUS_LABELS, BxTask, Bx24User } from '@/types/bitrix';
import TaskFilterBar from '@/components/TaskFilterBar';
import {
  EMPTY_FILTERS,
  filterQueryParams,
  initialFilterValues,
  taskFilterFields,
  taskFilterPresets,
  type FilterFieldKey,
} from '@/lib/task-filters';
import { boardStageQueries, coveredStageIds, REST_STAGES_COLUMN } from '@/lib/kanban-stage-queries';
import {
  useCallback,
  useDeferredValue,
  startTransition,
  useState,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { convertBxTask } from '@/store/kanban';
import TaskModal from './TaskModal';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Filter, Calendar, Timer, AlignLeft, Search, MoveHorizontal } from 'lucide-react';
import { Avatar } from '@/components/monos/Avatar';
import { Badge, type Tone } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Chip } from '@/components/monos/Chip';
import { Drawer } from '@/components/monos/Drawer';
import { EmptyState } from '@/components/monos/EmptyState';
import { IconButton } from '@/components/monos/IconButton';
import { Menu } from '@/components/monos/Menu';
import { Modal } from '@/components/monos/Modal';
import { SearchField } from '@/components/monos/SearchField';
import { SelectField } from '@/components/monos/SelectField';
import { useToast } from '@/components/monos/toast';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { useIsMobile } from '@/hooks/useIsMobile';
import LoadingState from '@/components/LoadingState';
import { type KanbanSort } from '@/lib/kanban-sort';
import { extractTaskTags } from '@/lib/task-tags';
import { dateFormat, numberFormat, t } from '@/lib/i18n';

// Панель над доской: контролы набора — 44px на телефоне и 36px на мыши.
// Ниже 36px мышь промахивается, а палец по 32px не попадает.
const toolbarControl = 'h-11 sm:h-9 rounded-ui';
const toolbarSelect = 'h-11 sm:h-9';
const toolbarPanel =
  'flex w-full flex-wrap items-center gap-2 rounded-ui border border-line bg-surface-2 p-2.5';

// Точка стадии: цвет берём из ролей набора, а не из палитры Tailwind.
function getStageDotColor(hex: string): string {
  const colors: Record<string, string> = {
    '47d1e2': 'bg-info',
    '75d900': 'bg-success',
    ffab00: 'bg-warning',
    ff5752: 'bg-danger',
    '1eae43': 'bg-success',
  };
  return colors[hex?.toLowerCase()] || 'bg-ink-muted';
}

// Приоритет — это состояние, а не украшение: цвет приходит из ролей набора.
const PRIORITY_TONES: Record<string, { tone: Tone; className: string }> = {
  low: { tone: 'neutral', className: 'bg-surface-2' },
  medium: { tone: 'neutral', className: 'bg-surface-2' },
  high: { tone: 'warning', className: 'bg-warning/10' },
  critical: { tone: 'danger', className: 'bg-danger/10' },
};

// Форматтеры один раз на модуль: toLocale*String строит новый на каждый
// вызов, а formatDeadline зовётся на каждую карточку доски.
const DAY_MONTH = dateFormat({ month: 'short', day: 'numeric' });
const WEEKDAY = dateFormat({ weekday: 'short' });
const HOUR_MINUTE = dateFormat({ hour: '2-digit', minute: '2-digit' });

function formatDeadline(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    let day = DAY_MONTH.format(date);
    if (diff === 0) day = t('Сегодня');
    else if (diff === 1) day = t('Завтра');
    else if (diff === -1) day = t('Вчера');
    else if (diff > 1 && diff < 7) day = WEEKDAY.format(date);
    else if (diff < 0 && diff > -7) day = WEEKDAY.format(date);

    return `${day}, ${HOUR_MINUTE.format(date)}`;
  } catch {
    return '';
  }
}

type KanbanStagePage = { tasks: BxTask[]; total: number; loading: boolean };
const KANBAN_PAGE_SIZE = 50;

export default function KanbanBoard({ toolbar }: { toolbar?: ReactNode }) {
  const {
    tasks,
    stages,
    selectedProjectId,
    moveTaskToStage,
    setSelectedTask,
    createTask,
    createStage,
    renameStage,
    isLoading,
    stagesLoadedFor,
    taskFilters,
    taskSearch,
    setTaskFilter,
    setTaskFilters,
    setTaskSearch,
    enterFilterScope,
    users,
    projects,
    currentUser,
    loadTaskById,
  } = useKanbanStore(
    useShallow((s) => ({
      tasks: s.tasks,
      stages: s.stages,
      selectedProjectId: s.selectedProjectId,
      moveTaskToStage: s.moveTaskToStage,
      setSelectedTask: s.setSelectedTask,
      createTask: s.createTask,
      createStage: s.createStage,
      renameStage: s.renameStage,
      isLoading: s.isLoading,
      stagesLoadedFor: s.stagesLoadedFor,
      taskFilters: s.taskFilters,
      taskSearch: s.taskSearch,
      setTaskFilter: s.setTaskFilter,
      setTaskFilters: s.setTaskFilters,
      setTaskSearch: s.setTaskSearch,
      enterFilterScope: s.enterFilterScope,
      users: s.users,
      projects: s.projects,
      currentUser: s.currentUser,
      loadTaskById: s.loadTaskById,
    })),
  );
  const router = useRouter();
  const toast = useToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Задача, которую мы только что открыли: пока адрес не обновился, её нельзя
  // закрывать — иначе карточка мигнёт и перечитается из портала дважды.
  const pendingTaskRef = useRef<string | null>(null);

  const openTask = useCallback(
    (taskId: string) => {
      pendingTaskRef.current = taskId;
      setSelectedTask(taskId);
      const params = new URLSearchParams(searchParams.toString());
      params.set('task', taskId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, setSelectedTask],
  );
  const closeTask = useCallback(() => {
    setSelectedTask(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('task');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams, setSelectedTask]);

  // Кнопка «назад» убирает задачу из адреса — карточку надо закрыть. Раньше
  // это делал эффект страницы проекта, но он же закрывал её и в момент
  // открытия, когда адрес ещё не успел обновиться.
  const taskFromUrl = searchParams.get('task');
  const selectedTaskId = useKanbanStore((s) => s.selectedTaskId);
  useEffect(() => {
    if (taskFromUrl) {
      pendingTaskRef.current = null;
      return;
    }
    if (pendingTaskRef.current) return;
    if (selectedTaskId) setSelectedTask(null);
  }, [setSelectedTask, selectedTaskId, taskFromUrl]);

  // Доска и список проекта делят один набор фильтров: входим в тот же scope,
  // тогда переключение вида их не сбрасывает, а смена проекта — сбрасывает.
  const statusFromUrl = searchParams.get('status') || 'all';
  useEffect(() => {
    if (!selectedProjectId) return;
    enterFilterScope(`project:${selectedProjectId}`, initialFilterValues(statusFromUrl));
  }, [enterFilterScope, selectedProjectId, statusFromUrl]);

  const [kanbanSort, setKanbanSort] = useState<KanbanSort>('urgency');
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
  // only a fallback for projects that do not have task stages configured —
  // и только после ответа task.stages.get: иначе доска успевала нарисоваться
  // по заглушкам New/In Progress/Done, загрузить по ним задачи и через
  // полсекунды перестроиться на настоящие стадии. Это и было мигание.
  // Если Битрикс не ответил на task.stages.get за пару секунд, рисуем
  // системные колонки: лучше фолбэк, чем спиннер без конца.
  const [stagesTimedOut, setStagesTimedOut] = useState(false);
  useEffect(() => {
    setStagesTimedOut(false);
    if (!selectedProjectId) return;
    const timer = window.setTimeout(() => setStagesTimedOut(true), 2500);
    return () => window.clearTimeout(timer);
  }, [selectedProjectId]);
  const stagesReady = stages.length > 0 || stagesLoadedFor === selectedProjectId || stagesTimedOut;
  // Набор стадий по подписи, а не по ссылке на массив: store отдаёт новый
  // массив стадий при каждой загрузке, и список запросов доски пересобирался бы
  // заново — доска спрашивала бы Битрикс дважды.
  const stageSignature = `${stagesReady ? 'ready' : 'wait'}|${stages
    .map((stage) => `${stage.id}:${stage.systemType ?? ''}`)
    .join('|')}`;
  // Название фазы — тоже часть содержимого колонки: без него переименованная
  // фаза осталась бы со старым заголовком до перезагрузки проекта.
  const stageContentSignature = `${stageSignature}|${stages.map((stage) => stage.name).join('|')}`;
  const allStages = useMemo(
    () =>
      (stages.length > 0 ? stages : stagesReady ? defaultStages : [])
        .slice()
        .sort((a, b) => a.sort - b.sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- подпись описывает тот же набор
    [stageContentSignature],
  );
  const deferredSearch = useDeferredValue(taskSearch);
  // Список тегов проекта — тот же источник, что у списка задач.
  const [boardTags, setBoardTags] = useState<Array<{ tag: string; label: string; count: number }>>(
    [],
  );
  useEffect(() => {
    if (!selectedProjectId) return;
    let cancelled = false;
    void fetch(`/api/tasks/tags?projectId=${encodeURIComponent(selectedProjectId)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setBoardTags(Array.isArray(data.tags) ? data.tags : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);
  const stageKey = allStages.map((stage) => stage.id).join(',');
  const [stagePages, setStagePages] = useState<Record<string, KanbanStagePage>>({});
  const stageRequestVersion = useRef(0);
  // Задачи без фазы (stageId «0») в списке фаз проекта отсутствуют, поэтому
  // отдельным запросом их не достать: без этого они молча пропадали с доски.
  // Запрашиваем их вместе с системной фазой «Новые» — ровно туда их и
  // рисует displayedStageId.
  const stageQueries = useMemo(() => boardStageQueries(allStages), [allStages]);
  // Фазы, которые доска уже забрала. Всё остальное (удалённые фазы, проекты
  // без доступа к task.stages.get) доска тоже показывает — отдельной
  // колонкой «Без фазы».
  const restStageIds = useMemo(() => coveredStageIds(allStages).join(','), [allStages]);
  // Пока первая выборка колонок не пришла, доска показывает спиннер, а не
  // пустые колонки: так же ведёт себя список задач.
  const [boardReady, setBoardReady] = useState(false);
  const isMobile = useIsMobile();
  const loadStagePage = useCallback(
    async (
      stageId: string,
      page: number,
      replace = false,
      requestVersion = stageRequestVersion.current,
      excludeStageIds = '',
    ) => {
      if (!selectedProjectId) return;
      setStagePages((current) => ({
        ...current,
        [stageId]: {
          tasks: current[stageId]?.tasks || [],
          total: current[stageId]?.total || 0,
          loading: true,
        },
      }));
      // В фильтре стадий может быть несколько значений: «Новые» забирает ещё и
      // задачи без фазы.
      const stageParam = stageQueries.find((item) => item.columnId === stageId)?.query || stageId;
      const params = new URLSearchParams({
        // Те же параметры, что шлёт список: фильтры общие, значит и запрос один.
        ...filterQueryParams(taskFilters),
        page: String(page),
        limit: String(KANBAN_PAGE_SIZE),
        projectId: selectedProjectId,
        stageId: stageParam,
        query: deferredSearch,
        sortKey: kanbanSort === 'urgency' ? 'deadline' : kanbanSort,
        sortDirection: 'asc',
      });
      // Колонка «Без фазы» спрашивает всё, чего нет в известных фазах, поэтому
      // фильтр по конкретной фазе ей не нужен.
      if (excludeStageIds) {
        params.delete('stageId');
        params.set('excludeStageIds', excludeStageIds);
      }
      try {
        const response = await fetch(`/api/tasks/all?${params.toString()}`);
        if (!response.ok) throw new Error(`tasks/all HTTP ${response.status}`);
        const data = await response.json();
        if (requestVersion !== stageRequestVersion.current) return;
        const nextTasks: BxTask[] = (Array.isArray(data.tasks) ? data.tasks : []).map(
          convertBxTask,
        );
        setStagePages((current) => {
          const previous = current[stageId]?.tasks || [];
          return {
            ...current,
            [stageId]: {
              tasks: replace
                ? nextTasks
                : [
                    ...previous,
                    ...nextTasks.filter((task) => !previous.some((item) => item.id === task.id)),
                  ],
              total: Number(data.total) || 0,
              loading: false,
            },
          };
        });
      } catch {
        if (requestVersion !== stageRequestVersion.current) return;
        setStagePages((current) => ({
          ...current,
          [stageId]: { ...(current[stageId] || { tasks: [], total: 0 }), loading: false },
        }));
      }
    },
    [deferredSearch, taskFilters, kanbanSort, selectedProjectId, stageQueries],
  );
  useEffect(() => {
    if (!selectedProjectId || !stageKey) return;
    const requestVersion = ++stageRequestVersion.current;
    setBoardReady(false);
    startTransition(() => setStagePages({}));
    // Колонок может быть больше, чем фаз в проекте: к «Новым» добавляется
    // запрос задач без фазы, а сверху — колонка «Без фазы» для фазы, которой
    // доска не знает.
    const requests = [
      ...stageQueries.map((item) => loadStagePage(item.columnId, 1, true, requestVersion)),
      loadStagePage(REST_STAGES_COLUMN, 1, true, requestVersion, restStageIds),
    ];
    // Снимаем спиннер по первому ответу, а не по последнему: доска рисуется
    // сразу, остальные колонки наполняются по мере готовности.
    const reveal = () => {
      if (requestVersion === stageRequestVersion.current) setBoardReady(true);
    };
    if (!requests.length) reveal();
    requests.forEach((request) => void request.then(reveal).catch(reveal));
  }, [loadStagePage, selectedProjectId, stageKey, stageSignature]);
  const filteredTasks = useMemo(
    () => Object.values(stagePages).flatMap((stage) => stage.tasks),
    [stagePages],
  );
  const newStageId = allStages.find((stage) => stage.systemType === 'NEW')?.id;
  // Older Bitrix tasks may retain stage "0" after a project switches to
  // custom stages. Render them in the project's system "New" phase instead
  // of dropping them from the board.
  const displayedStageId = (task: BxTask) =>
    task.stageId === '0' && newStageId ? newStageId : task.stageId;

  // Tasks whose stageId does not match any known stage (deleted stage,
  // permissions error on task.stages.get, project Kanban disabled, …) get
  // rendered in a dedicated fallback column so they are never silently lost.
  // Такие задачи приходят отдельным запросом (REST_STAGES_COLUMN), но в
  // filteredTasks они уже учтены, поэтому фильтр по неизвестной фазе их
  // тоже находит.
  const knownStageIds = new Set(allStages.map((stage) => stage.id));
  const orphanTasks = filteredTasks.filter((task) => !knownStageIds.has(displayedStageId(task)));
  if (orphanTasks.length > 0 && process.env.NODE_ENV !== 'production') {
    // ponytail: dev-only — silent in prod, noisy when something is misconfigured.
    console.warn(
      t('[kanban] {0} задач(а) вне известных стадий — проверь task.stages.get', orphanTasks.length),
    );
  }

  const showFilters = useKanbanStore((state) => state.filtersPanelOpen);
  const setShowFilters = useKanbanStore((state) => state.setFiltersPanelOpen);
  const [activePreset, setActivePreset] = useState('');
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
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // Inline "+ задача" в колонке: stageId открытой формы. null = нигде не открыта.
  const [inlineAddStage, setInlineAddStage] = useState<string | null>(null);
  const [showStageDialog, setShowStageDialog] = useState(false);
  const [stageName, setStageName] = useState('');
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageTitle, setEditingStageTitle] = useState('');
  const [isCreatingStage, setIsCreatingStage] = useState(false);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  // Первый поле каждого окна получает фокус: без ссылки модалка забирала бы
  // его на себя.
  const stageNameRef = useRef<HTMLInputElement>(null);
  const newTaskTitleRef = useRef<HTMLInputElement>(null);

  const selectedTask = useKanbanStore((s) =>
    s.selectedTaskId
      ? s.tasks.find((task) => task.id === s.selectedTaskId) ||
        s.allTasks.find((task) => task.id === s.selectedTaskId) ||
        null
      : null,
  );
  const currentProject = projects.find((p) => p.id === selectedProjectId);
  const avatarByUserId = new Map(users.map((user) => [user.id, user.icon]));

  if (!selectedProjectId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-canvas">
        <EmptyState
          icon={<Search size={28} strokeWidth={1.7} />}
          title={t('Проект не выбран')}
          description={t('Выберите проект в боковой панели, чтобы увидеть задачи')}
        />
      </div>
    );
  }

  const activeFiltersCount = Object.entries(taskFilters).filter(
    ([key, value]) => value !== EMPTY_FILTERS[key as FilterFieldKey],
  ).length;

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

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    if (draggedTask) {
      const taskId = draggedTask;
      await loadTaskById(taskId);
      await moveTaskToStage(taskId, stageId);
      setStagePages((current) => {
        const moved = Object.values(current)
          .flatMap((item) => item.tasks)
          .find((task) => task.id === taskId);
        if (!moved) return current;
        const sourceStageId = Object.entries(current).find(([, item]) =>
          item.tasks.some((task) => task.id === taskId),
        )?.[0];
        if (!sourceStageId || sourceStageId === stageId) return current;
        const next = Object.fromEntries(
          Object.entries(current).map(([id, item]) => [
            id,
            {
              ...item,
              tasks: item.tasks.filter((task) => task.id !== taskId),
              total: id === sourceStageId ? Math.max(0, item.total - 1) : item.total,
            },
          ]),
        );
        const destination = next[stageId] || { tasks: [], total: 0, loading: false };
        next[stageId] = {
          ...destination,
          tasks: [{ ...moved, stageId }, ...destination.tasks],
          total: destination.total + 1,
        };
        return next;
      });
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
        void loadStagePage(newTask.stageId || newStageId || '0', 1, true);
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
    if (created) void loadStagePage(stageId, 1, true);
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
    } else if (stageName.trim()) {
      // Иначе диалог просто останется открытым, а пользователь решит, что
      // приложение зависло.
      toast({ title: t('Не удалось создать фазу'), tone: 'danger' });
    }
    setIsCreatingStage(false);
  };

  // Отказ Битрикса («Вы не можете управлять стадиями») откатывает название,
  // но без сообщения переименование выглядит как «ничего не произошло».
  const handleRenameStage = async (stageId: string, title: string) => {
    try {
      await renameStage(stageId, title);
    } catch (error) {
      toast({
        title: t('Не удалось переименовать фазу'),
        description: error instanceof Error ? error.message : undefined,
        tone: 'danger',
      });
    }
  };

  // Ровно та же строка фильтров, что в списке задач: поля, пресеты и чипы
  // общие, состояние — одно на оба вида.
  const filterControls = (
    <TaskFilterBar
      fields={taskFilterFields({
        users,
        tags: boardTags,
        statusLabels: STATUS_LABELS,
      })}
      values={taskFilters}
      presets={taskFilterPresets(currentUser.id)}
      activePreset={activePreset}
      onChange={(key, value) => {
        setActivePreset('');
        setTaskFilter(key, value);
      }}
      onApplyPreset={(preset) => {
        const next = activePreset === preset.id ? null : preset;
        setActivePreset(next ? next.id : '');
        setTaskFilters({ ...EMPTY_FILTERS, ...(next?.values ?? {}) });
      }}
      onReset={() => {
        setActivePreset('');
        setTaskFilters(EMPTY_FILTERS);
        setTaskSearch('');
        if (isMobile) setShowFilters(false);
      }}
      stacked={isMobile}
    />
  );

  return (
    <div className="flex min-w-0 flex-col bg-canvas">
      {/* Header */}
      {/* overflow-x-clip, а не overflow-hidden: при overflow-hidden шапка
          становится скролл-контейнером, и браузер прокручивает её, когда
          фокус уходит в выпадающий список фильтров. Строка фильтров с чипами
          уезжала при этом за верхний край, и снять фильтр было нечем. */}
      <header className="sticky top-0 z-10 overflow-x-clip border-b border-line bg-canvas px-4 py-4 sm:px-6">
        {/* На узком экране скрытый горизонтальный скролл прятал «Фильтр» и
            «Добавить задачу» без всякого намёка — переносим строки. */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:flex-nowrap lg:gap-3 lg:overflow-x-auto lg:overflow-y-hidden">
          {toolbar}
          <SelectField
            value={kanbanSort}
            onChange={(event) => setKanbanSort(event.target.value as KanbanSort)}
            options={[
              { value: 'urgency', label: t('По срочности') },
              { value: 'updated', label: t('По обновлению') },
              { value: 'deadline', label: t('По дедлайну') },
              { value: 'title', label: t('По названию') },
            ]}
            variant="boxed"
            className={`${toolbarSelect} w-40 shrink-0`}
            aria-label={t('Сортировка задач')}
          />
          <SearchField
            value={taskSearch}
            onChange={(value) => setTaskSearch(value)}
            placeholder={t('Поиск задач…')}
            label={t('Поиск задач на доске')}
            className="w-48 shrink-0"
          />
          <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
            <Button
              variant={showFilters || activeFiltersCount > 0 ? 'primary' : 'quiet'}
              size="md"
              className={toolbarControl}
              onClick={() => setShowFilters(!showFilters)}
              icon={<Filter size={14} strokeWidth={1.7} />}
            >
              {t('Фильтры')}
              {activeFiltersCount > 0 && (
                <Badge tone="accent" className="ml-2">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>

            <Button
              variant="secondary"
              size="md"
              className={toolbarControl}
              onClick={() => setShowStageDialog(true)}
              icon={<Plus size={14} strokeWidth={1.7} />}
            >
              {t('Фаза')}
            </Button>

            <Button
              size="md"
              className={toolbarControl}
              onClick={openAddDialog}
              icon={<Plus size={14} strokeWidth={1.7} />}
            >
              {t('Добавить задачу')}
            </Button>
          </div>
        </div>

        {/* Filters panel — на телефоне уезжает в боковой ящик */}
        {showFilters && !isMobile && (
          <div className={`mt-3 animate-slide-up ${toolbarPanel}`}>{filterControls}</div>
        )}
      </header>

      {isMobile && (
        <Drawer
          open={showFilters}
          onClose={() => setShowFilters(false)}
          side="right"
          title={t('Фильтры')}
        >
          <div className="flex flex-col gap-3 [&_[data-slot=select-trigger]]:h-11 [&_button:not([role=checkbox])]:h-11">
            {filterControls}
          </div>
        </Drawer>
      )}

      <Modal
        open={showStageDialog}
        onClose={() => setShowStageDialog(false)}
        title={t('Новая фаза')}
        size="md"
        initialFocus={stageNameRef}
        footer={
          <>
            <Button variant="quiet" onClick={() => setShowStageDialog(false)}>
              {t('Отмена')}
            </Button>
            <Button
              onClick={() => void handleCreateStage()}
              disabled={!stageName.trim() || isCreatingStage}
            >
              {isCreatingStage ? t('Создаём…') : t('Создать')}
            </Button>
          </>
        }
      >
        <TextField
          ref={stageNameRef}
          value={stageName}
          onChange={(event) => setStageName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void handleCreateStage()}
          placeholder={t('Например, На согласовании')}
          aria-label={t('Название фазы')}
          autoFocus
        />
      </Modal>

      {/* Верхний scrollbar — только desktop; синхронизирован с доской ниже. */}
      <div
        ref={topScrollRef}
        onScroll={(event) => {
          if (boardScrollRef.current)
            boardScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        className="hidden overflow-x-auto border-b border-line bg-canvas lg:block"
      >
        <div className="flex min-w-max gap-4 px-4 py-2 xl:gap-5">
          {allStages.map((stage) => (
            <div key={stage.id} className="h-px w-[14rem] xl:w-[15rem]" />
          ))}
          {orphanTasks.length > 0 && <div className="h-px w-[14rem] xl:w-[15rem]" />}
        </div>
      </div>

      {/* Board */}
      {(!boardReady || (isLoading && !filteredTasks.length)) && (
        <LoadingState className="min-h-72 flex-1 bg-transparent" />
      )}
      <div
        hidden={!boardReady || (isLoading && !filteredTasks.length)}
        ref={boardScrollRef}
        onScroll={(event) => {
          if (topScrollRef.current)
            topScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        className="flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-canvas lg:snap-none"
      >
        <div className="flex h-full min-w-max gap-3 px-4 py-4 xl:gap-4">
          {allStages.map((stage) => {
            const colTasks = filteredTasks.filter((task) => displayedStageId(task) === stage.id);
            const isDragOver = dragOverColumn === stage.id;

            return (
              <Card
                key={stage.id}
                padding="none"
                className={`w-[20rem] shrink-0 snap-start bg-surface-2 lg:w-[14rem] lg:snap-none xl:w-[15rem] ${
                  isDragOver ? 'border-accent bg-accent/10' : ''
                }`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => void handleDrop(e, stage.id)}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                  <div className={`w-2 h-2 rounded-full ${getStageDotColor(stage.color)}`} />
                  {editingStageId === stage.id ? (
                    <TextField
                      autoFocus
                      value={editingStageTitle}
                      onChange={(event) => setEditingStageTitle(event.target.value)}
                      onBlur={() => {
                        if (editingStageTitle.trim())
                          void handleRenameStage(stage.id, editingStageTitle);
                        setEditingStageId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') setEditingStageId(null);
                      }}
                      size="sm"
                      className="min-w-0 flex-1"
                      aria-label={t('Название фазы')}
                    />
                  ) : (
                    <h2
                      className="flex-1 cursor-text text-sm font-bold text-ink"
                      onDoubleClick={() => {
                        setEditingStageId(stage.id);
                        setEditingStageTitle(stage.name);
                      }}
                    >
                      {stage.name}
                    </h2>
                  )}
                  <span className="text-xs text-ink-faint">
                    {colTasks.length}
                    {stagePages[stage.id] ? ` / ${stagePages[stage.id].total}` : ''}
                  </span>
                  <IconButton
                    label={t('Добавить задачу в фазу {0}', stage.name)}
                    variant="ghost"
                    size="sm"
                    onClick={() => setInlineAddStage(stage.id)}
                  >
                    <Plus size={15} strokeWidth={1.7} />
                  </IconButton>
                </div>

                {/* Tasks list */}
                <div className="flex-1 p-2 space-y-1.5 overflow-y-auto min-h-[200px]">
                  {colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      avatarUrl={task.assigneeAvatar || avatarByUserId.get(task.assigneeId || '')}
                      onDragStart={handleDragStart}
                      stages={allStages}
                      onMoveToStage={(taskId, stageId) => void moveTaskToStage(taskId, stageId)}
                      onClick={() => {
                        // Сначала полная задача: карточке нужны права на действия
                        // и теги. Открывать раньше — значит перечитывать её
                        // ещё раз уже в самой карточке.
                        void (async () => {
                          try {
                            await loadTaskById(task.id);
                          } catch {
                            // Не открываем карточку вслепую: откроем как есть.
                          }
                          openTask(task.id);
                        })();
                      }}
                      isDragging={draggedTask === task.id}
                    />
                  ))}

                  {inlineAddStage === stage.id && (
                    <InlineAddForm
                      defaultAssigneeId={currentUser.id}
                      users={users}
                      onSubmit={(data) => handleInlineAdd(stage.id, data)}
                      onCancel={() => setInlineAddStage(null)}
                    />
                  )}
                  {(stagePages[stage.id]?.tasks.length || 0) <
                    (stagePages[stage.id]?.total || 0) && (
                    <Button
                      variant="quiet"
                      size="md"
                      full
                      disabled={stagePages[stage.id]?.loading}
                      onClick={() =>
                        void loadStagePage(
                          stage.id,
                          Math.floor((stagePages[stage.id]?.tasks.length || 0) / KANBAN_PAGE_SIZE) +
                            1,
                        )
                      }
                    >
                      {stagePages[stage.id]?.loading ? t('Загружаем…') : t('Показать ещё')}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}

          {orphanTasks.length > 0 && (
            <Card
              padding="none"
              className="w-[20rem] flex-shrink-0 border-dashed opacity-80 lg:w-[14rem] xl:w-[15rem]"
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
              <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <div className="w-2 h-2 rounded-full bg-ink-muted" />
                <h2 className="flex-1 text-sm font-bold text-ink">{t('Без фазы')}</h2>
                <span className="text-xs text-ink-faint">{orphanTasks.length}</span>
              </div>
              <div className="flex-1 p-2 space-y-1.5 overflow-y-auto min-h-[200px]">
                {orphanTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    avatarUrl={task.assigneeAvatar || avatarByUserId.get(task.assigneeId || '')}
                    onDragStart={handleDragStart}
                    stages={allStages}
                    onMoveToStage={(taskId, stageId) => void moveTaskToStage(taskId, stageId)}
                    onClick={() => openTask(task.id)}
                    isDragging={draggedTask === task.id}
                  />
                ))}
                {(stagePages[REST_STAGES_COLUMN]?.tasks.length || 0) <
                  (stagePages[REST_STAGES_COLUMN]?.total || 0) && (
                  <Button
                    variant="quiet"
                    size="md"
                    full
                    disabled={stagePages[REST_STAGES_COLUMN]?.loading}
                    onClick={() =>
                      void loadStagePage(
                        REST_STAGES_COLUMN,
                        Math.floor(
                          (stagePages[REST_STAGES_COLUMN]?.tasks.length || 0) / KANBAN_PAGE_SIZE,
                        ) + 1,
                        false,
                        stageRequestVersion.current,
                        restStageIds,
                      )
                    }
                  >
                    {stagePages[REST_STAGES_COLUMN]?.loading ? t('Загружаем…') : t('Показать ещё')}
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Add Task Modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t('Новая задача')}
        size="lg"
        initialFocus={newTaskTitleRef}
        footer={
          <>
            <Button variant="quiet" onClick={() => setShowAddModal(false)}>
              {t('Отмена')}
            </Button>
            <Button
              onClick={handleAddTask}
              disabled={!newTask.title.trim() || !newTask.responsibleId}
            >
              {t('Создать задачу')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-ui bg-surface-2 px-3 py-2 text-sm text-ink-soft">
            {t('Проект:')} <span className="font-medium text-ink">{currentProject?.name}</span>
          </div>
          <TextField
            ref={newTaskTitleRef}
            label={t('Название задачи *')}
            value={newTask.title}
            onChange={(event) => setNewTask((value) => ({ ...value, title: event.target.value }))}
            placeholder={t('Что нужно сделать')}
            autoFocus
          />
          <TextArea
            label={t('Описание')}
            value={newTask.description}
            onChange={(event) =>
              setNewTask((value) => ({ ...value, description: event.target.value }))
            }
            placeholder={t('Контекст и ожидаемый результат')}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label={t('Исполнитель')}
              value={newTask.responsibleId || 'unassigned'}
              onChange={(event) =>
                setNewTask((item) => ({
                  ...item,
                  responsibleId: event.target.value === 'unassigned' ? '' : event.target.value,
                }))
              }
              options={[
                { value: 'unassigned', label: t('Выберите исполнителя'), disabled: true },
                ...users.map((user) => ({ value: user.id, label: user.name })),
              ]}
            />
            <SelectField
              label={t('Приоритет')}
              value={newTask.priority}
              onChange={(event) =>
                setNewTask((item) => ({ ...item, priority: event.target.value }))
              }
              options={[
                { value: 'low', label: t('Низкий') },
                { value: 'medium', label: t('Обычный') },
                { value: 'high', label: t('Высокий') },
              ]}
            />
            <TextField
              label={t('Дедлайн')}
              type="datetime-local"
              value={newTask.deadline}
              onChange={(event) =>
                setNewTask((item) => ({ ...item, deadline: event.target.value }))
              }
            />
            <TextField
              label={t('Оценка, часы')}
              type="number"
              min="0"
              step="0.5"
              value={newTask.estimate}
              onChange={(event) =>
                setNewTask((item) => ({ ...item, estimate: event.target.value }))
              }
              placeholder={t('Например, 2.5')}
            />
          </div>
          <SelectField
            label={t('Фаза')}
            value={newTask.stageId || 'none'}
            onChange={(event) =>
              setNewTask((item) => ({
                ...item,
                stageId: event.target.value === 'none' ? '' : event.target.value,
              }))
            }
            options={[
              { value: 'none', label: t('Не выбрана') },
              ...allStages.map((stage) => ({ value: stage.id, label: stage.name })),
            ]}
          />
        </div>
      </Modal>

      {selectedTask && <TaskModal task={selectedTask} onClose={closeTask} />}
    </div>
  );
}

function InlineAddForm({
  onSubmit,
  onCancel,
  users,
  defaultAssigneeId,
}: {
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
    <div className="rounded-ui border border-line bg-canvas p-2 shadow-rest">
      <TextField
        ref={inputRef}
        variant="boxed"
        size="sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={t('Название задачи…')}
        aria-label={t('Название задачи')}
        disabled={submitting}
      />
      <div className="mt-2 flex items-center gap-1">
        <SelectField
          value={assigneeId || 'unassigned'}
          onChange={(event) =>
            setAssigneeId(event.target.value === 'unassigned' ? '' : event.target.value)
          }
          options={[
            { value: 'unassigned', label: t('Без исполнителя') },
            ...users.map((u) => ({ value: u.id, label: u.name })),
          ]}
          size="sm"
          disabled={submitting}
          className="min-w-0 flex-1"
          aria-label={t('Исполнитель')}
        />
        <SelectField
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          options={[
            { value: 'low', label: t('Низкий') },
            { value: 'medium', label: t('Обычный') },
            { value: 'high', label: t('Высокий') },
          ]}
          size="sm"
          className="w-24"
          aria-label={t('Приоритет')}
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button size="md" variant="quiet" onClick={onCancel} disabled={submitting}>
          {t('Отмена')}
        </Button>
        <Button size="md" onClick={() => void submit()} disabled={!title.trim() || submitting}>
          {submitting ? '…' : t('Создать')}
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
  stages,
  onMoveToStage,
}: {
  task: BxTask;
  avatarUrl?: string;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: () => void;
  isDragging: boolean;
  stages: Array<{ id: string; name: string }>;
  onMoveToStage: (taskId: string, stageId: string) => void;
}) {
  const priority = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.medium;
  const priorityTone = PRIORITY_TONES[task.priority] || PRIORITY_TONES.medium;
  const taskTags = task.tags?.length ? task.tags : extractTaskTags(task.title, task.description);
  const isCompleted = task.status === 'done';
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';
  const dueDate = formatDeadline(task.dueDate);
  const completedSubtasks = task.subtasks?.filter((s) => s.status === 'done').length || 0;
  const totalSubtasks = task.subtasks?.length || 0;
  // «Обычный» стоит почти на всех задачах: чип на каждой карточке — шум, а не
  // сигнал. Показываем только отличие от нормы.
  const showPriority = task.priority !== 'medium';
  const hasChips = showPriority || taskTags.length > 0 || Boolean(task.parentId);

  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={onClick}
      // Колонка держит до 50 карточек, а видно от силы шесть: content-visibility
      // позволяет браузеру не отрисовывать то, что за пределами экрана.
      className={`group/card cursor-pointer border-transparent p-3 transition-colors [contain-intrinsic-size:auto_132px] [content-visibility:auto] hover:border-line-strong hover:shadow-lift ${
        isDragging ? 'opacity-40 rotate-1' : isCompleted ? 'bg-surface-2 text-ink-soft' : ''
      }`}
    >
      {/* Перенос карточки: HTML5 drag&drop не работает на тач-экранах, поэтому
          фазу можно выбрать и списком. */}
      <div
        className="absolute right-2 top-2 z-10 pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 focus-within:opacity-100"
        // Клик по меню не должен открывать карточку.
        onClick={(event) => event.stopPropagation()}
      >
        <Menu
          label={t('Переместить в фазу')}
          align="end"
          width="auto"
          items={stages.map((stage) => ({
            value: stage.id,
            label: stage.name,
            disabled: stage.id === task.stageId,
            onSelect: () => onMoveToStage(task.id, stage.id),
          }))}
          trigger={
            <IconButton
              label={t('Переместить задачу {0}', task.title)}
              variant="ghost"
              size="sm"
              onClick={(event) => event.stopPropagation()}
            >
              <MoveHorizontal className="size-4" strokeWidth={1.7} />
            </IconButton>
          }
        />
      </div>
      {hasChips && (
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1 pr-6">
          {showPriority && (
            <Badge
              tone={priorityTone.tone}
              className={`shrink-0 whitespace-nowrap rounded-ui px-1.5 py-0.5 ${priorityTone.className}`}
            >
              {priority.label}
            </Badge>
          )}
          {taskTags.slice(0, 3).map((tag) => (
            <Chip key={tag} title={tag} className="max-w-28">
              {tag}
            </Chip>
          ))}
          {taskTags.length > 3 && <Chip>+{taskTags.length - 3}</Chip>}
          {task.parentId && <Chip tone="accent">{t('Подзадача')}</Chip>}
        </div>
      )}

      {/* Title and description indicator share one row so the icon never changes card height. */}
      <div className={`mb-2 flex items-start gap-1 ${hasChips ? '' : 'pr-6'}`}>
        <h3
          className={`min-w-0 flex-1 text-sm leading-snug line-clamp-2 xl:line-clamp-3 ${
            isCompleted ? 'text-ink-soft line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </h3>
        {task.description && (
          <AlignLeft className="mt-0.5 shrink-0 text-ink-faint" size={14} strokeWidth={1.7} />
        )}
      </div>

      {/* Meta footer — в узких колонках (224px) «План + Факт» не помещаются
          в одну строку с дедлайном и аватаром. Перенос строк и truncate у
          дедлайна/оценки чинят наложение, не ломая внешний вид на широких. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span
            className={`flex min-w-0 items-center gap-1 ${isOverdue ? 'text-danger-text font-medium' : ''}`}
          >
            <Calendar size={12} strokeWidth={1.7} className="shrink-0" />
            <span className="truncate">{dueDate || t('Без срока')}</span>
          </span>
          {(task.estimate > 0 || task.actualTime > 0) && (
            <span className="flex items-center gap-1">
              <Timer size={12} strokeWidth={1.7} className="shrink-0" />
              <span className="truncate">
                {task.estimate > 0 && t('План {0} ч', task.estimate)}
                {task.estimate > 0 && task.actualTime > 0 && ', '}
                {task.actualTime > 0 && t('Факт {0} ч', task.actualTime)}
              </span>
            </span>
          )}
          {totalSubtasks > 0 && (
            <span className="flex items-center gap-1">
              <span aria-hidden>☐</span>
              {completedSubtasks}/{totalSubtasks}
            </span>
          )}
        </div>

        {task.assigneeName && (
          <AssigneeAvatar
            key={avatarUrl || 'no-avatar'}
            name={task.assigneeName}
            avatarUrl={avatarUrl}
          />
        )}
      </div>
    </Card>
  );
}

function AssigneeAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <span title={name} className="inline-flex shrink-0">
      <Avatar name={name} src={avatarUrl} size="xs" />
    </span>
  );
}

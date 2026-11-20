'use client';
import { useKanbanStore } from '@/store/kanban';
import { useShallow } from 'zustand/react/shallow';
import { STATUS_LABELS, BxTask } from '@/types/bitrix';
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
import { fetchTaskById, type Bx24Stage } from '@/lib/bitrix24';
import TaskModal from './TaskModal';
import RefreshButton from '@/components/RefreshButton';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Pencil, Plus, Filter, Search, SlidersHorizontal } from 'lucide-react';
import { DateField } from '@/components/monos/DateField';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Card } from '@/components/monos/Card';
import { Drawer } from '@/components/monos/Drawer';
import { EmptyState } from '@/components/monos/EmptyState';
import { IconButton } from '@/components/monos/IconButton';
import { Modal } from '@/components/monos/Modal';
import { SearchField } from '@/components/monos/SearchField';
import { SelectField } from '@/components/monos/SelectField';
import { useToast } from '@/components/monos/toast';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import { useIsMobile } from '@/hooks/useIsMobile';
import LoadingState from '@/components/LoadingState';
import { type KanbanSort } from '@/lib/kanban-sort';
import { t } from '@/lib/i18n';
import { pluralRu } from '@/lib/utils';
import { TaskCard } from '@/components/kanban/TaskCard';
import { InlineAddForm } from '@/components/kanban/InlineAddForm';

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

type KanbanStagePage = { tasks: BxTask[]; total: number; loading: boolean; next: number | null };
const KANBAN_OFFSET_STEP = '50';
// Фолбэк для проектов без настроенных фаз: константа на модуль, чтобы ссылка
// на массив не менялась при каждом рендере доски.
const DEFAULT_STAGES: Bx24Stage[] = [
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
const SHOWN_FIELDS = [
  'stageId',
  'status',
  'title',
  'priority',
  'dueDate',
  'assigneeId',
  'assigneeName',
  'assigneeAvatar',
  'estimate',
  'actualTime',
  'tags',
  'accompliceIds',
] as const satisfies readonly (keyof BxTask)[];

// Поля в SHOWN_FIELDS — примитивы плюс два массива строк, поэтому хватает
// строгого сравнения и поэлементной проверки массивов. Прежнее
// JSON.stringify на каждое поле каждой задачи — это лишний парсинг строк
// на каждое изменение любой задачи в сторе.
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => item === b[index])
    );
  }
  return a === b;
}

export default function KanbanBoard({ toolbar }: { toolbar?: ReactNode }) {
  const {
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
  const defaultStages = DEFAULT_STAGES;
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
  // Колонки доски живут в локальном состоянии, поэтому правки из карточки (фаза, статус,
  // срок) они сами не видят. Переносим изменение из стора и перекладываем задачу в новую колонку.
  const storeTasks = useKanbanStore((s) => s.allTasks);
  const applyTaskChange = useCallback((next: Partial<BxTask> & { id: string }) => {
    setStagePages((current) => {
      const source = Object.entries(current).find(([, page]) =>
        page.tasks.some((task) => task.id === next.id),
      );
      if (!source) return current;
      const [sourceId, sourcePage] = source;
      const old = sourcePage.tasks.find((task) => task.id === next.id)!;
      const targetId =
        old.stageId === next.stageId
          ? sourceId
          : Object.keys(current).find((id) => id === next.stageId) || sourceId;
      if (targetId === sourceId) {
        return {
          ...current,
          [sourceId]: {
            ...sourcePage,
            tasks: sourcePage.tasks.map((task) =>
              task.id === next.id ? ({ ...task, ...next, stageId: task.stageId } as BxTask) : task,
            ),
          },
        };
      }
      const target = current[targetId];
      return {
        ...current,
        [sourceId]: {
          ...sourcePage,
          tasks: sourcePage.tasks.filter((task) => task.id !== next.id),
          total: Math.max(0, sourcePage.total - 1),
        },
        [targetId]: {
          ...target,
          tasks: [{ ...old, ...next } as BxTask, ...target.tasks],
          total: target.total + 1,
        },
      };
    });
  }, []);
  useEffect(() => {
    const byId = new Map(storeTasks.map((task) => [task.id, task]));
    for (const page of Object.values(stagePages)) {
      for (const task of page.tasks) {
        const fresh = byId.get(task.id);
        if (!fresh || fresh === task) continue;
        // Только то, что рисует карточка доски: остальное в списке и в сторе устроено по-разному
        // (подзадачи, комментарии), и затирать его нельзя.
        const patch: Partial<BxTask> & { id: string } = { id: task.id };
        for (const key of SHOWN_FIELDS) {
          const value = fresh[key];
          if (value !== undefined && !sameFieldValue(value, task[key]))
            Object.assign(patch, { [key]: value });
        }
        if (patch.stageId && !(patch.stageId in stagePages)) delete patch.stageId;
        if (Object.keys(patch).length === 1) continue;
        applyTaskChange(patch);
        // Портал сам двигает задачу по системным фазам при смене статуса (в работу, завершена):
        // стор этого не знает, поэтому спрашиваем актуальную фазу.
        if (fresh.status !== task.status && fresh.stageId === task.stageId) {
          void fetchTaskById(task.id)
            .then((raw) => {
              const stageId = convertBxTask(raw).stageId;
              if (stageId === fresh.stageId) return;
              // Пишем и в стор, иначе сравнение выше вернёт задачу в старую колонку.
              const patch = (item: BxTask) => (item.id === task.id ? { ...item, stageId } : item);
              useKanbanStore.setState((state) => ({
                tasks: state.tasks.map(patch),
                allTasks: state.allTasks.map(patch),
              }));
            })
            .catch(() => {});
        }
      }
    }
  }, [storeTasks, stagePages, applyTaskChange]);
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
      offset: number,
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
          next: current[stageId]?.next ?? null,
        },
      }));
      // В фильтре стадий может быть несколько значений: «Новые» забирает ещё и
      // задачи без фазы.
      const stageParam = stageQueries.find((item) => item.columnId === stageId)?.query || stageId;
      const params = new URLSearchParams({
        // Те же параметры, что шлёт список: фильтры общие, значит и запрос один.
        ...filterQueryParams(taskFilters),
        // Offset вместо page: после переносов задачи уходят между колонками и
        // арифметика «задач / 50 + 1» просит не ту страницу, а offset отдаёт
        // сервер сам (nextOffset) — дубли и пропуски не тянутся.
        offset: String(offset),
        limit: KANBAN_OFFSET_STEP,
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
              // Доверяем границе сервера, а не подсчёту на клиенте: локальные
              // оптимистичные переносы сбивают счётчик задач в колонке.
              next: data.nextOffset ?? null,
            },
          };
        });
      } catch {
        if (requestVersion !== stageRequestVersion.current) return;
        setStagePages((current) => ({
          ...current,
          [stageId]: {
            ...(current[stageId] || { tasks: [], total: 0, next: null }),
            loading: false,
          },
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
      ...stageQueries.map((item) => loadStagePage(item.columnId, 0, true, requestVersion)),
      loadStagePage(REST_STAGES_COLUMN, 0, true, requestVersion, restStageIds),
    ];
    // Снимаем спиннер по первому ответу, а не по последнему: доска рисуется
    // сразу, остальные колонки наполняются по мере готовности.
    const reveal = () => {
      if (requestVersion === stageRequestVersion.current) setBoardReady(true);
    };
    if (!requests.length) reveal();
    requests.forEach((request) => void request.then(reveal).catch(reveal));
  }, [loadStagePage, selectedProjectId, stageKey, stageSignature]);

  // Событие портала (SSE → tasksVersion): зеркало в Mongo уже обновлено,
  // доска тихо перечитывает свои колонки. Без этого правки с портала не
  // доезжали до доски вовсе — колонки жили только на локальных правках,
  // до смены фильтров. Дебаунс склеивает пачку событий в одну перечитку,
  // доска не мигает: колонки замещаются по месту, без сброса в спиннер.
  const tasksVersion = useKanbanStore((s) => s.tasksVersion);
  const loadedVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (loadedVersionRef.current === null) {
      // Первый рендер: колонки уже грузит основной эффект, события не ждём.
      loadedVersionRef.current = tasksVersion;
      return;
    }
    if (loadedVersionRef.current === tasksVersion) return;
    loadedVersionRef.current = tasksVersion;
    if (!selectedProjectId || !stageKey) return;
    const timer = window.setTimeout(() => {
      const requestVersion = ++stageRequestVersion.current;
      const request = (stageId: string, excludeStageIds = '') =>
        loadStagePage(stageId, 0, true, requestVersion, excludeStageIds);
      void Promise.all([
        ...stageQueries.map((item) => request(item.columnId)),
        request(REST_STAGES_COLUMN, restStageIds),
      ]);
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restStageIds/Stable подписи stageQueries описаны stageKey
  }, [tasksVersion, selectedProjectId, stageKey]);
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
  // Раскладка задач по колонкам один раз на изменение списка, а не фильтр
  // в каждой колонке на каждый рендер доски.
  const tasksByStage = useMemo(() => {
    const map = new Map<string, BxTask[]>();
    for (const task of filteredTasks) {
      const id = displayedStageId(task);
      const list = map.get(id);
      if (list) list.push(task);
      else map.set(id, [task]);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayedStageId зависит только от newStageId
  }, [filteredTasks, newStageId]);
  const orphanTasks = filteredTasks.filter((task) => !knownStageIds.has(displayedStageId(task)));
  if (orphanTasks.length > 0 && process.env.NODE_ENV !== 'production') {
    // ponytail: dev-only — silent in prod, noisy when something is misconfigured.
    console.warn(
      `[kanban] ${orphanTasks.length} ${pluralRu(orphanTasks.length, ['задача', 'задачи', 'задач'])} вне известных стадий — проверь task.stages.get`,
    );
  }

  const showFilters = useKanbanStore((state) => state.filtersPanelOpen);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrap = moreOpen ? 'contents' : 'max-sm:hidden sm:contents';
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
  // Полосы двигают друг друга. Scroll от сдвинутой нами полосы приходит кадром позже, когда
  // ведущая уже уехала дальше, и ответ откатывал её назад: прокрутка шла рывками. Поэтому
  // событие, которое мы сами вызвали, гасим, а не пересылаем обратно.
  const echoRef = useRef<HTMLElement | null>(null);
  const syncScroll = (from: HTMLElement, to: HTMLElement | null) => {
    if (echoRef.current === from) {
      echoRef.current = null;
      return;
    }
    if (!to || Math.abs(to.scrollLeft - from.scrollLeft) < 1) return;
    const before = to.scrollLeft;
    to.scrollLeft = from.scrollLeft;
    // Упёрлась в край, события не будет, и гасить нечего.
    echoRef.current = to.scrollLeft === before ? null : to;
  };
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
  const avatarByUserId = useMemo(() => new Map(users.map((user) => [user.id, user.icon])), [users]);

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

  // Доска держит задачи колонок у себя, а в сторе их может не быть: тогда перенос молча
  // ничего не делал. Сначала подгружаем задачу, как при перетаскивании.
  const moveCardToStage = async (taskId: string, stageId: string) => {
    try {
      await loadTaskById(taskId);
      await moveTaskToStage(taskId, stageId);
    } catch {
      toast({ title: t('Не удалось перенести задачу'), tone: 'danger' });
    }
  };

  // Колонку перестраивает эффект синхронизации со стором: оптимистичная правка
  // moveTaskToStage уходит в стор, эффект перекладывает задачу между колонками
  // и правит счётчики. Здесь только чистим drag-состояние — и до запроса, а не
  // после: при отказе портала карточка не должна оставаться полупрозрачной.
  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const taskId = draggedTask;
    setDraggedTask(null);
    setDragOverColumn(null);
    if (taskId) await moveCardToStage(taskId, stageId);
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
        void loadStagePage(newTask.stageId || newStageId || '0', 0, true);
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
    if (created) void loadStagePage(stageId, 0, true);
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
        {/* Второй ряд контролов на 1366px дешевле спрятанного скролла: правые
            кнопки иначе уезжали за край без единого намёка. */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:gap-3">
          {toolbar}
          <div className={moreWrap}>
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
          </div>
          <SearchField
            value={taskSearch}
            onChange={(value) => setTaskSearch(value)}
            placeholder={t('Поиск задач…')}
            label={t('Поиск задач на доске')}
            className="w-48 shrink-0"
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-lg:max-w-full lg:ml-auto lg:flex-nowrap">
            <div className={moreWrap}>
              <RefreshButton
                className={toolbarControl}
                onRefresh={async () => {
                  const { loadTasks, selectedProjectId: project } = useKanbanStore.getState();
                  await loadTasks(project ?? undefined);
                  if (useKanbanStore.getState().error) throw new Error('refresh failed');
                }}
              />
            </div>
            {/* Сортировка, обновление и фаза на телефоне за одной кнопкой: четыре ряда
                контролов отнимали у доски половину экрана. */}
            <Button
              variant="quiet"
              size="sm"
              className={`${toolbarControl} sm:hidden`}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
              icon={<SlidersHorizontal size={14} strokeWidth={1.7} />}
            >
              {t('Ещё')}
            </Button>
            <Button
              variant={showFilters || activeFiltersCount > 0 ? 'primary' : 'quiet'}
              size="sm"
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
              size="sm"
              className={`${toolbarControl} ${moreOpen ? '' : 'max-sm:hidden'}`}
              onClick={() => setShowStageDialog(true)}
              icon={<Plus size={14} strokeWidth={1.7} />}
            >
              {t('Фаза')}
            </Button>

            <Button
              size="sm"
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
        onScroll={(event) => syncScroll(event.currentTarget, boardScrollRef.current)}
        className="hidden overflow-x-auto border-b border-line bg-canvas lg:block"
      >
        <div className="flex gap-3 px-4 py-2 xl:gap-4">
          {allStages.map((stage) => (
            <div key={stage.id} className="h-px flex-[1_0_14rem] max-w-[22rem]" />
          ))}
          {orphanTasks.length > 0 && <div className="h-px flex-[1_0_14rem] max-w-[22rem]" />}
        </div>
      </div>

      {/* Board */}
      {(!boardReady || (isLoading && !filteredTasks.length)) && (
        <LoadingState className="min-h-72 flex-1 bg-transparent" />
      )}
      {/* На телефоне горизонтальный скролл колонок неудобен: показываем
          вертикальные секции по фазам, перенос — из меню карточки. */}
      {isMobile && boardReady && (!isLoading || filteredTasks.length > 0) && (
        <div className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-4">
          {allStages.map((stage) => {
            const colTasks = tasksByStage.get(stage.id) || [];
            const hasMore = (stagePages[stage.id]?.next ?? null) !== null;
            const isRest = stage.id === REST_STAGES_COLUMN;
            if (!colTasks.length && !hasMore) return null;

            return (
              <Card key={stage.id} padding="none" data-stage={stage.id} className="bg-surface-2">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isRest ? 'bg-ink-muted' : getStageDotColor(stage.color)
                    }`}
                  />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                    {isRest ? t('Остальные фазы') : stage.name}
                  </h2>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint">
                    {colTasks.length}
                    {/* Дробь только пока колонка догружается: «1 / 1» повторяло само себя. */}
                    {(stagePages[stage.id]?.total ?? 0) > colTasks.length
                      ? ` / ${stagePages[stage.id].total}`
                      : ''}
                  </span>
                </div>
                <div className="space-y-1.5 p-2">
                  {colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      avatarUrl={task.assigneeAvatar || avatarByUserId.get(task.assigneeId || '')}
                      onDragStart={handleDragStart}
                      isDragging={draggedTask === task.id}
                      stages={allStages}
                      onMoveToStage={(taskId, stageId) => void moveCardToStage(taskId, stageId)}
                      onClick={() => void openTask(task.id)}
                    />
                  ))}
                  {hasMore && (
                    <Button
                      variant="quiet"
                      size="md"
                      full
                      disabled={stagePages[stage.id]?.loading}
                      onClick={() =>
                        void (isRest
                          ? loadStagePage(
                              REST_STAGES_COLUMN,
                              stagePages[REST_STAGES_COLUMN]?.next || 0,
                              false,
                              stageRequestVersion.current,
                              restStageIds,
                            )
                          : loadStagePage(stage.id, stagePages[stage.id]?.next || 0))
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
            <Card padding="none" className="border-dashed bg-surface-2 opacity-80">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <div className="h-2 w-2 rounded-full bg-ink-muted" />
                <h2 className="flex-1 text-sm font-bold text-ink">{t('Без фазы')}</h2>
                <span className="text-xs text-ink-faint">{orphanTasks.length}</span>
              </div>
              <div className="space-y-1.5 p-2">
                {orphanTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    avatarUrl={task.assigneeAvatar || avatarByUserId.get(task.assigneeId || '')}
                    onDragStart={handleDragStart}
                    isDragging={draggedTask === task.id}
                    stages={allStages}
                    onMoveToStage={(taskId, stageId) => void moveCardToStage(taskId, stageId)}
                    onClick={() => void openTask(task.id)}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
      <div
        hidden={!boardReady || (isLoading && !filteredTasks.length) || isMobile}
        ref={boardScrollRef}
        onScroll={(event) => syncScroll(event.currentTarget, topScrollRef.current)}
        // Без scroll-snap: в окне уже lg (iframe портала) доску притягивало к краю колонки,
        // и прокрутка тачпадом липла посреди движения.
        className="flex-1 overflow-x-auto overscroll-x-contain bg-canvas"
      >
        {/* На десктопе без min-w-max: с ним ширину колонки задавало содержимое, а не
            свободное место, и четвёртая колонка уезжала за край экрана. */}
        <div className="flex h-full min-w-max gap-3 px-4 py-4 lg:min-w-0 xl:gap-4">
          {allStages.map((stage) => {
            const colTasks = tasksByStage.get(stage.id) || [];
            const isDragOver = dragOverColumn === stage.id;

            return (
              <Card
                key={stage.id}
                padding="none"
                // data-stage:_tests целились в колонку хрупким xpath-предком;
                // после скрытия закрытых пустая колонка теряла h3 и предок
                // вылезал на всю доску.
                data-stage={stage.id}
                // На десктопе колонка растёт до 22rem, пока на экране есть место: при
                // фиксированных 14rem половина широкого окна пустовала, а в карточках
                // обрезались теги и переносилась строка со сроком и часами.
                className={`w-[20rem] shrink-0 bg-surface-2 lg:w-auto lg:flex-[1_0_14rem] lg:max-w-[22rem] ${
                  isDragOver ? 'border-accent bg-accent/10' : ''
                }`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => void handleDrop(e, stage.id)}
              >
                {/* Column header */}
                <div className="group flex items-center gap-2 border-b border-line px-3 py-2.5">
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
                  <IconButton
                    label={t('Переименовать фазу {0}', stage.name)}
                    variant="ghost"
                    size="sm"
                    // Карандаш в каждой шапке был шумом: показываем его по наведению на
                    // шапку и по фокусу с клавиатуры. Двойной клик по названию тоже правит.
                    className="opacity-0 transition-opacity duration-fast focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => {
                      setEditingStageId(stage.id);
                      setEditingStageTitle(stage.name);
                    }}
                  >
                    <Pencil size={14} strokeWidth={1.7} />
                  </IconButton>
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint">
                    {colTasks.length}
                    {/* Дробь только пока колонка догружается: «1 / 1» повторяло само себя. */}
                    {(stagePages[stage.id]?.total ?? 0) > colTasks.length
                      ? ` / ${stagePages[stage.id].total}`
                      : ''}
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
                      onMoveToStage={(taskId, stageId) => void moveCardToStage(taskId, stageId)}
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

                  {!colTasks.length && inlineAddStage !== stage.id && (
                    <p className="px-2 py-8 text-center text-xs text-ink-faint">
                      {t('Перетащите задачу сюда')}
                    </p>
                  )}
                  {inlineAddStage === stage.id && (
                    <InlineAddForm
                      defaultAssigneeId={currentUser.id}
                      users={users}
                      onSubmit={(data) => handleInlineAdd(stage.id, data)}
                      onCancel={() => setInlineAddStage(null)}
                    />
                  )}
                  {(stagePages[stage.id]?.next ?? null) !== null && (
                    <Button
                      variant="quiet"
                      size="md"
                      full
                      disabled={stagePages[stage.id]?.loading}
                      onClick={() => void loadStagePage(stage.id, stagePages[stage.id]?.next || 0)}
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
              data-stage="0"
              className="w-[20rem] flex-shrink-0 border-dashed opacity-80 lg:w-auto lg:flex-[1_0_14rem] lg:max-w-[22rem]"
              // Колонка без фазы не принимает перенос: сбрасывать фазу (stageId «0»)
              // REST Битрикса здесь нельзя (см. moveTaskToProject), и дроп вхолостую
              // выглядел бы как сработавший перенос.
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
                    onMoveToStage={(taskId, stageId) => void moveCardToStage(taskId, stageId)}
                    onClick={() => openTask(task.id)}
                    isDragging={draggedTask === task.id}
                  />
                ))}
                {(stagePages[REST_STAGES_COLUMN]?.next ?? null) !== null && (
                  <Button
                    variant="quiet"
                    size="md"
                    full
                    disabled={stagePages[REST_STAGES_COLUMN]?.loading}
                    onClick={() =>
                      void loadStagePage(
                        REST_STAGES_COLUMN,
                        stagePages[REST_STAGES_COLUMN]?.next || 0,
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
            <DateField
              label={t('Дедлайн')}
              withTime
              value={newTask.deadline}
              onChange={(value) => setNewTask((item) => ({ ...item, deadline: value }))}
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

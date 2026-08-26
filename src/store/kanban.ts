import { create } from 'zustand';
import {
  BxTask,
  BxComment,
  TimeEntry,
  TaskStatus,
  TaskFilters,
  DashboardStats,
  Bx24User,
} from '@/types/bitrix';
import * as persist from './persist';
import {
  fetchTasksByProject,
  fetchProjectList,
  fetchSubtasks,
  fetchTaskComments,
  fetchTaskTimeLog,
  searchTasks,
  fetchUsers,
  fetchProjectStages,
  updateTaskStatus as bxUpdateStatus,
  updateTaskFull as bxUpdateTaskFull,
  addTaskComment as bxAddComment,
  addTimeEntry as bxAddTime,
  createTask as bxCreateTask,
  Bx24Task,
  Bx24Project,
  Bx24Stage,
  mapBxPriority,
  secondsToHours,
  hoursToSeconds,
} from '@/lib/bitrix24';

interface KanbanStore {
  // Данные
  projects: Bx24Project[];
  tasks: BxTask[];
  subtasks: Record<string, BxTask[]>;
  users: Bx24User[];
  stages: Bx24Stage[];
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  currentUser: { id: string; name: string; photo?: string };

  // Все задачи по всем доступным проектам (для /all-tasks)
  allTasks: BxTask[];
  isLoadingAllTasks: boolean;

  // Фильтры
  filters: TaskFilters;

  // Поиск
  searchQuery: string;
  searchResults: BxTask[];
  isSearching: boolean;
  showSearch: boolean;

  // Пагинация
  hasMoreTasks: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isLoadingTask: boolean;
  error: string | null;

  // Actions
  setSelectedProject: (id: string | null) => void;
  setSelectedTask: (id: string | null) => void;
  setCurrentUser: (user: { id: string; name: string; photo?: string }) => void;
  loadProjects: (force?: boolean) => Promise<void>;
  loadStages: (entityId: string) => Promise<void>;
  loadTasks: (groupId?: string | boolean, reset?: boolean) => Promise<void>;
  loadAllTasks: () => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  loadSubtasks: (parentId: string) => Promise<void>;
  loadTaskDetails: (taskId: string) => Promise<void>;
  setFilters: (filters: Partial<TaskFilters>) => void;
  search: (query: string) => Promise<void>;
  toggleSearch: () => void;
  updateTaskField: (id: string, field: string, value: any) => Promise<void>;
  moveTask: (taskId: string, newStatus: TaskStatus) => void;
  moveTaskToStage: (taskId: string, stageId: string) => Promise<void>;
  addComment: (taskId: string, text: string) => void;
  addTimeEntry: (taskId: string, hours: number, description: string) => void;
  createTask: (data: {
    title: string;
    description?: string;
    responsibleId?: string;
    priority?: string;
    deadline?: string;
    estimate?: number;
    parentId?: string;
    stageId?: string;
  }) => Promise<string | null>;

  // Восстановление из localStorage (вызывать в useEffect чтобы избежать hydration mismatch)
  rehydrateFromStorage: () => void;
  setMemberId: (id: string) => void;

  // Computed
  getFilteredTasks: () => BxTask[];
  getDashboardStats: () => DashboardStats;
  getMyTasks: () => BxTask[];
  getOverdueTasks: () => BxTask[];
  getGlobalCounts: () => { overdue: number; in_progress: number; done: number };
}

function convertBxTask(bxTask: Bx24Task): BxTask {
  return {
    id: bxTask.id,
    projectId: bxTask.groupId,
    title: bxTask.title,
    description: bxTask.description,
    // REST v2 returns the completed task status as "5", while the UI uses
    // semantic status names for counters and filters.
    status: bxTask.status === '5' ? 'done' : (bxTask.status as TaskStatus),
    priority: mapBxPriority(bxTask.priority),
    assigneeId: bxTask.responsibleId,
    assigneeName: bxTask.responsibleName,
    createdDate: bxTask.createdDate,
    updatedDate: bxTask.changedDate,
    dueDate: bxTask.deadline,
    estimate: secondsToHours(bxTask.timeEstimate),
    actualTime: secondsToHours(bxTask.timeSpentInLogs),
    comments: [],
    timeEntries: [],
    // Bitrix represents a root task as the string "0". Keep only a real
    // parent id so root tasks are not visually labelled as subtasks.
    parentId: bxTask.parentId && bxTask.parentId !== '0' ? bxTask.parentId : undefined,
    subtasks: [],
    stageId: bxTask.stageId || '0',
  };
}

const defaultFilters: TaskFilters = {
  search: '',
  assigneeId: '',
  priority: '',
  status: '',
  hasDeadline: false,
  overdue: false,
  showCompleted: true, // По умолчанию показываем завершённые
};

// Загружаем из localStorage только на клиенте через rehydrate() чтобы избежать hydration mismatch
export const useKanbanStore = create<KanbanStore>((set, get) => ({
  projects: [],
  tasks: [],
  subtasks: {},
  users: [],
  stages: [],
  selectedProjectId: null,
  selectedTaskId: null,
  currentUser: { id: '', name: 'Не определён' },
  allTasks: [],
  isLoadingAllTasks: false,
  filters: defaultFilters,
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  showSearch: false,
  hasMoreTasks: false,
  isLoading: false,
  isLoadingMore: false,
  isLoadingTask: false,
  error: null,

  setSelectedProject: (id) => {
    set({
      selectedProjectId: id,
      tasks: [],
      hasMoreTasks: false,
      filters: defaultFilters,
      stages: [],
      isLoading: Boolean(id),
    });
    if (id) {
      // Stages first, then tasks: otherwise the first render shows the
      // fallback columns and every task briefly looks orphan.
      void get().loadStages(id).then(() => get().loadTasks(id, true));
    }
  },

  setSelectedTask: (id) => {
    set({ selectedTaskId: id });
    if (id) get().loadTaskDetails(id);
  },

  setCurrentUser: (currentUser) => set({ currentUser }),

  loadProjects: async (force = false) => {
    const { projects } = get();
    console.log(
      '[STORE] loadProjects START',
      'projects=',
      projects.length,
      'memberId=',
      typeof window !== 'undefined' ? localStorage.getItem('bitrix_member_id') : 'no-window',
    );

    // Защита от дублирующих вызовов
    if (!force && projects.length > 0) return;

    set({ isLoading: true, error: null });
    try {
      const memberId =
        typeof window !== 'undefined' ? localStorage.getItem('bitrix_member_id') || '' : '';

      // Один batch запрос вместо двух параллельных
      const res = await fetch('/api/dashboard', {
        headers: { 'X-Member-Id': memberId },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load');
      }

      const { projects: projectsResult, users: usersResult, currentUser } = await res.json();

      set({
        projects: projectsResult || [],
        users: usersResult || [],
        currentUser: currentUser?.id ? currentUser : get().currentUser,
        isLoading: false,
      });

      if (typeof window !== 'undefined') {
        try {
          persist.saveToStorage({ projects: projectsResult, users: usersResult, currentUser });
        } catch {}
      }
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  loadStages: async (entityId: string) => {
    try {
      const stages = await fetchProjectStages(entityId);
      set({ stages });
      if (typeof window !== 'undefined') {
        try {
          const all = (persist.loadFromStorage().stages as any) || {};
          all[entityId] = stages;
          persist.saveToStorage({ stages: all });
        } catch {}
      }
    } catch (err) {
      console.error('Failed to load stages:', err);
    }
  },

  loadTasks: async (groupId?: string | boolean, reset: boolean = true) => {
    const { selectedProjectId, filters } = get();
    const projectId = typeof groupId === 'string' ? groupId : selectedProjectId;

    if (!projectId) return;

    set({ isLoading: reset, isLoadingMore: !reset });

    try {
      const { tasks, hasMore } = await fetchTasksByProject(projectId, {
        limit: 50,
        // The board always retains completed tasks in their original phases.
        // Hiding them made a fully completed project look empty.
        status: 'all',
        filter: {
          responsibleId: filters.assigneeId || undefined,
          priority: filters.priority || undefined,
        },
      });

      const mapped = tasks.map(convertBxTask);

      set({
        tasks: mapped,
        hasMoreTasks: hasMore,
        isLoading: false,
        isLoadingMore: false,
      });
    } catch (err: any) {
      set({ error: err.message, isLoading: false, isLoadingMore: false });
    }
  },

  // Загружает задачи по всем доступным проектам (для /all-tasks).
  // Прогоняем проекты параллельно, лимит per-project=50, обрезаем до ~500
  // суммарно чтобы не задушить Битрикс.
  loadAllTasks: async () => {
    const { projects } = get();
    if (projects.length === 0) {
      set({ allTasks: [], isLoadingAllTasks: false });
      return;
    }
    set({ isLoadingAllTasks: true });
    try {
      const results = await Promise.all(
        projects.map((p) =>
          fetchTasksByProject(p.id, {
            limit: 50,
            status: 'all',
          }).catch(() => ({ tasks: [], hasMore: false, total: 0 })),
        ),
      );
      const mapped = results.flatMap((r) => r.tasks.map(convertBxTask));
      set({ allTasks: mapped, isLoadingAllTasks: false });
      // Stale-while-revalidate: кладём в localStorage, чтобы после F5
      // счётчики в сайдбаре показались мгновенно из кэша.
      persist.saveToStorage({
        allTasks: mapped,
        allTasksCachedAt: Date.now(),
      });
    } catch (err: any) {
      set({ error: err.message, isLoadingAllTasks: false });
    }
  },

  loadMoreTasks: async () => {
    const { isLoadingMore, hasMoreTasks, selectedProjectId, tasks, filters } = get();
    if (isLoadingMore || !hasMoreTasks || !selectedProjectId) return;

    set({ isLoadingMore: true });

    try {
      const { tasks: newTasks, hasMore } = await fetchTasksByProject(selectedProjectId, {
        limit: 50,
        offset: tasks.length,
        status: 'all',
        filter: {
          responsibleId: filters.assigneeId || undefined,
          priority: filters.priority || undefined,
        },
      });

      const mapped = newTasks.map(convertBxTask);

      set((state) => ({
        tasks: [...state.tasks, ...mapped],
        hasMoreTasks: hasMore,
        isLoadingMore: false,
      }));
    } catch (err: any) {
      set({ error: err.message, isLoadingMore: false });
    }
  },

  loadSubtasks: async (parentId: string) => {
    try {
      const subtaskList = await fetchSubtasks(parentId);
      const mapped = subtaskList.map(convertBxTask);
      set((state) => ({
        subtasks: { ...state.subtasks, [parentId]: mapped },
      }));
    } catch (err) {
      console.error('Failed to load subtasks:', err);
    }
  },

  loadTaskDetails: async (taskId: string) => {
    set({ isLoadingTask: true });

    // Comments are visible immediately after the task modal opens. Do not make
    // them wait for the slower time-log and subtask requests.
    try {
      const comments = await fetchTaskComments(taskId);
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                comments: comments.map((c) => ({ ...c, taskId })),
              }
            : t,
        ),
        isLoadingTask: false,
      }));
    } catch (err: any) {
      set({ isLoadingTask: false });
    }

    void Promise.all([fetchTaskTimeLog(taskId), fetchSubtasks(taskId)])
      .then(([timeLog, subtaskList]) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  timeEntries: timeLog.map((e) => ({
                    ...e,
                    taskId,
                    hours: secondsToHours(e.seconds),
                  })),
                  subtasks: subtaskList.map(convertBxTask),
                }
              : t,
          ),
          subtasks: { ...state.subtasks, [taskId]: subtaskList.map(convertBxTask) },
        }));
      })
      .catch(() => {});
  },

  setFilters: (newFilters) => {
    set((state) => ({ filters: { ...state.filters, ...newFilters } }));
    get().loadTasks(true);
  },

  search: async (query: string) => {
    set({ searchQuery: query });
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }

    set({ isSearching: true });
    try {
      const results = await searchTasks(query);
      set({ searchResults: results.map(convertBxTask), isSearching: false });
    } catch {
      set({ searchResults: [], isSearching: false });
    }
  },

  toggleSearch: () => set((state) => ({ showSearch: !state.showSearch })),

  updateTaskField: async (id, field, value) => {
    const { tasks, users } = get();
    const previous = tasks.find((task) => task.id === id);
    if (!previous) return;

    // Optimistic update
    const update: Partial<BxTask> = {};
    if (field === 'assigneeId') {
      const user = users.find((item) => item.id === value);
      update.assigneeId = value;
      update.assigneeName = user?.name || 'Не назначен';
    } else if (field === 'priority') update.priority = value;
    else if (field === 'deadline') update.dueDate = value;
    else if (field === 'estimate') update.estimate = value;
    else if (field === 'title') update.title = value;
    else if (field === 'description') update.description = value;
    else if (field === 'status') update.status = value;
    else if (field === 'parentId') update.parentId = value;

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...update, updatedDate: new Date().toISOString() } : t,
      ),
    }));

    // Sync
    const bxFields: Record<string, any> = {};
    if (field === 'assigneeId') bxFields.responsibleId = value;
    else if (field === 'priority') bxFields.priority = value;
    else if (field === 'deadline') bxFields.deadline = value || null;
    else if (field === 'estimate') bxFields.estimate = value;
    else if (field === 'title') bxFields.title = value;
    else if (field === 'description') bxFields.description = value;
    else if (field === 'parentId') bxFields.parentId = value || 0;

    try {
      if (Object.keys(bxFields).length > 0) await bxUpdateTaskFull(id, bxFields);
      // Status update
      if (field === 'status') {
        let bxStatus = '2',
          bxSubStatus = '-2';
        if (value === 'done') {
          bxStatus = '5';
          bxSubStatus = '5';
        } else if (value === 'in_progress') {
          bxStatus = '2';
          bxSubStatus = '-3';
        } else if (value === 'testing') {
          bxStatus = '2';
          bxSubStatus = '-4';
        }
        await bxUpdateStatus(id, bxStatus, bxSubStatus);
      }
    } catch (error) {
      console.error('Task field update failed:', error);
      set((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? previous : task)) }));
      throw error;
    }
  },

  moveTask: (taskId, newStatus) => {
    get().updateTaskField(taskId, 'status', newStatus);
  },

  moveTaskToStage: async (taskId, stageId) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, stageId } : t)),
    }));
    try {
      await bxUpdateTaskFull(taskId, { stageId });
    } catch (err) {
      console.error('Move task failed:', err);
    }
  },

  addComment: async (taskId, text) => {
    const { currentUser } = get();
    const tempId = `temp-${Date.now()}`;

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              comments: [
                ...t.comments,
                {
                  id: tempId,
                  taskId,
                  authorId: currentUser.id,
                  authorName: currentUser.name,
                  text,
                  createdDate: new Date().toISOString(),
                },
              ],
            }
          : t,
      ),
    }));

    try {
      const result = await bxAddComment(taskId, text);
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                comments: t.comments.map((c) => (c.id === tempId ? { ...c, id: result } : c)),
              }
            : t,
        ),
      }));
    } catch {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, comments: t.comments.filter((c) => c.id !== tempId) } : t,
        ),
      }));
    }
  },

  addTimeEntry: async (taskId, hours, description) => {
    const { currentUser } = get();
    const tempId = `temp-${Date.now()}`;

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              timeEntries: [
                ...t.timeEntries,
                {
                  id: tempId,
                  taskId,
                  userId: currentUser.id,
                  userName: currentUser.name,
                  date: new Date().toISOString().split('T')[0],
                  hours,
                  description,
                },
              ],
              actualTime: t.actualTime + hours,
            }
          : t,
      ),
    }));

    try {
      await bxAddTime(taskId, hoursToSeconds(hours), description);
    } catch {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                timeEntries: t.timeEntries.filter((e) => e.id !== tempId),
                actualTime: t.actualTime - hours,
              }
            : t,
        ),
      }));
    }
  },

  rehydrateFromStorage: () => {
    if (typeof window === 'undefined') return;
    try {
      const data = persist.loadFromStorage();
      // Stale-while-revalidate: поднимаем allTasks из localStorage сразу,
      // чтобы счётчики в сайдбаре не показывали 0 пока идёт фоновая загрузка.
      const cachedAt = data.allTasksCachedAt ?? 0;
      const staleMs = Date.now() - cachedAt;
      const allTasks = staleMs < 10 * 60 * 1000 ? data.allTasks || [] : [];
      set({
        projects: data.projects || [],
        users: data.users || [],
        currentUser: data.currentUser || get().currentUser,
        stages: data.stages ? (Object.values(data.stages).flat() as any[]) : [],
        allTasks,
        // Route navigation may select a project before the layout effect restores
        // warm cache. Never let an old cache clear the active route selection.
        selectedProjectId: get().selectedProjectId || data.selectedProjectId || null,
      });
    } catch {}
  },

  setMemberId: (id: string) => {
    if (typeof window === 'undefined') return;
    if (id) localStorage.setItem('bitrix_member_id', id);
  },

  createTask: async (data) => {
    const { selectedProjectId } = get();
    if (!selectedProjectId) return null;

    try {
      await bxCreateTask({
        ...data,
        groupId: selectedProjectId,
      });
      await get().loadTasks(true);
      return 'ok';
    } catch (err: any) {
      console.error('Failed to create task:', err);
      return null;
    }
  },

  getFilteredTasks: () => {
    const { tasks, filters, selectedProjectId } = get();
    return tasks.filter((t) => {
      if (selectedProjectId && t.projectId !== selectedProjectId) return false;
      if (!filters.showCompleted && t.status === 'done') return false;
      if (filters.assigneeId && t.assigneeId !== filters.assigneeId) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.hasDeadline && !t.dueDate) return false;
      if (filters.overdue && t.dueDate) {
        const deadline = new Date(t.dueDate);
        const now = new Date();
        if (deadline >= now || t.status === 'done') return false;
      }
      return true;
    });
  },

  getDashboardStats: () => {
    const tasks = get().getFilteredTasks();
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === 'done').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      overdue: tasks.filter((t) => {
        if (!t.dueDate || t.status === 'done') return false;
        return new Date(t.dueDate) < new Date();
      }).length,
      totalEstimate: tasks.reduce((sum, t) => sum + t.estimate, 0),
      totalActual: tasks.reduce((sum, t) => sum + t.actualTime, 0),
    };
  },

  getMyTasks: () => {
    const { tasks, currentUser } = get();
    return tasks.filter((t) => t.assigneeId === currentUser.id);
  },

  getOverdueTasks: () => {
    const tasks = get().getFilteredTasks();
    return tasks.filter((t) => {
      if (!t.dueDate || t.status === 'done') return false;
      return new Date(t.dueDate) < new Date();
    });
  },

  // Глобальные счётчики по всем доступным задачам (allTasks).
  // Используются в сайдбаре, чтобы статусы «Просрочено / В работе / Готово»
  // совпадали с тем, что видит пользователь на /all-tasks.
  getGlobalCounts: () => {
    const now = new Date();
    const all = get().allTasks;
    return {
      overdue: all.filter(
        (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now,
      ).length,
      in_progress: all.filter((t) => t.status === 'in_progress').length,
      done: all.filter((t) => t.status === 'done').length,
    };
  },
}));

if (typeof window !== 'undefined') {
  setTimeout(() => {
    useKanbanStore.getState().loadProjects();
  }, 100);
  // Если в localStorage нет свежего кэша allTasks — догружаем сразу,
  // иначе loadProjects().then() в (dashboard)/page.tsx сам подтянет свежее.
  setTimeout(() => {
    const state = useKanbanStore.getState();
    if (state.projects.length > 0 && state.allTasks.length === 0) {
      void state.loadAllTasks();
    }
  }, 300);
}

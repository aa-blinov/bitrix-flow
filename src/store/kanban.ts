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
  fetchTaskById,
  fetchTaskTimeLog,
  fetchProjectMembers,
  fetchChecklist,
  addChecklistItem as bxAddChecklistItem,
  updateChecklistItem as bxUpdateChecklistItem,
  setChecklistItemCompleted as bxSetChecklistItemCompleted,
  deleteChecklistItem as bxDeleteChecklistItem,
  searchTasks,
  fetchUsers,
  fetchProjectStages,
  createProjectStage,
  updateProjectStage,
  createProject as bxCreateProject,
  updateProject as bxUpdateProject,
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
  getMemberId,
} from '@/lib/bitrix24';
import { mapBitrixTaskStatus } from '@/lib/task-status';

function getMemberIdHeader(): Record<string, string> {
  const id = getMemberId();
  return id ? { 'X-Member-Id': id } : {};
}

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
  isRehydrated: boolean;
  error: string | null;

  // Actions
  setSelectedProject: (id: string | null) => void;
  setSelectedTask: (id: string | null) => void;
  setCurrentUser: (user: { id: string; name: string; photo?: string }) => void;
  loadProjects: (force?: boolean) => Promise<void>;
  loadStages: (entityId: string) => Promise<void>;
  createStage: (title: string) => Promise<boolean>;
  renameStage: (stageId: string, title: string) => Promise<void>;
  createProject: (name: string, description?: string) => Promise<string>;
  updateProject: (
    id: string,
    fields: { name?: string; description?: string; archived?: boolean },
  ) => Promise<void>;
  loadTasks: (groupId?: string | boolean, reset?: boolean) => Promise<void>;
  loadAllTasks: () => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  loadSubtasks: (parentId: string) => Promise<void>;
  loadTaskDetails: (taskId: string) => Promise<void>;
  loadTaskById: (taskId: string) => Promise<BxTask | null>;
  setFilters: (filters: Partial<TaskFilters>) => void;
  search: (query: string) => Promise<void>;
  toggleSearch: () => void;
  updateTaskField: (id: string, field: string, value: any) => Promise<void>;
  moveTask: (taskId: string, newStatus: TaskStatus) => void;
  moveTaskToStage: (taskId: string, stageId: string) => Promise<void>;
  moveTaskToProject: (taskId: string, projectId: string) => Promise<void>;
  addComment: (taskId: string, text: string) => void;
  addTimeEntry: (taskId: string, hours: number, description: string) => void;
  addChecklistItem: (taskId: string, title: string, parentId?: string) => Promise<void>;
  updateChecklistItem: (taskId: string, itemId: string, title: string) => Promise<void>;
  setChecklistItemCompleted: (taskId: string, itemId: string, completed: boolean) => Promise<void>;
  deleteChecklistItem: (taskId: string, itemId: string) => Promise<void>;
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
    status: mapBitrixTaskStatus(bxTask.status),
    priority: mapBxPriority(bxTask.priority),
    assigneeId: bxTask.responsibleId,
    assigneeName: bxTask.responsibleName,
    assigneeAvatar: bxTask.responsibleIcon,
    createdDate: bxTask.createdDate,
    updatedDate: bxTask.changedDate,
    dueDate: bxTask.deadline,
    estimate: secondsToHours(bxTask.timeEstimate),
    actualTime: secondsToHours(bxTask.timeSpentInLogs),
    comments: [],
    commentsCount: bxTask.commentsCount,
    storyPoints: bxTask.storyPoints,
    checklist: [],
    timeEntries: [],
    // Bitrix represents a root task as the string "0". Keep only a real
    // parent id so root tasks are not visually labelled as subtasks.
    parentId: bxTask.parentId && bxTask.parentId !== '0' ? bxTask.parentId : undefined,
    subtasks: [],
    stageId: bxTask.stageId || '0',
    chatId: bxTask.chatId,
    accompliceIds: bxTask.accompliceIds,
    auditorIds: bxTask.auditorIds,
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

// Кэш поднимается в DashboardLayout после гидратации. Не читаем localStorage
// при инициализации стора: сервер и первый клиентский рендер должны совпадать.
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
  isRehydrated: false,
  error: null,

  setSelectedProject: (id) => {
    const cachedStages = id ? get().stages.filter((stage) => stage.entityId === id) : [];
    set({
      selectedProjectId: id,
      tasks: [],
      hasMoreTasks: false,
      filters: defaultFilters,
      stages: cachedStages,
      isLoading: Boolean(id),
    });
    if (id) {
      // Этапы не должны задерживать задачи: Bitrix может отвечать на них медленнее.
      void get().loadStages(id);
      void get().loadTasks(id, true);
    }
  },

  setSelectedTask: (id) => {
    set({ selectedTaskId: id });
    if (id) get().loadTaskDetails(id);
  },

  setCurrentUser: (currentUser) => set({ currentUser }),

  loadProjects: async (force = false) => {
    const { projects, isLoading } = get();

    // Защита от дублирующих вызовов
    if (isLoading || (!force && projects.length > 0)) return;

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

  createStage: async (title) => {
    const { selectedProjectId, stages } = get();
    if (!selectedProjectId || !title.trim()) return false;
    try {
      await createProjectStage(selectedProjectId, title.trim(), stages.at(-1)?.id);
      await get().loadStages(selectedProjectId);
      return true;
    } catch (error) {
      console.error('Create stage failed:', error);
      return false;
    }
  },

  renameStage: async (stageId, title) => {
    const { selectedProjectId, stages } = get();
    if (!selectedProjectId || !title.trim()) return;
    const previous = stages.find((stage) => stage.id === stageId);
    if (!previous) return;
    set((state) => ({
      stages: state.stages.map((stage) =>
        stage.id === stageId ? { ...stage, name: title.trim() } : stage,
      ),
    }));
    try {
      await updateProjectStage(selectedProjectId, stageId, title.trim());
    } catch (error) {
      set((state) => ({
        stages: state.stages.map((stage) => (stage.id === stageId ? previous : stage)),
      }));
      throw error;
    }
  },

  createProject: async (name, description) => {
    const id = await bxCreateProject(name, description);
    await get().loadProjects(true);
    return id;
  },

  updateProject: async (id, fields) => {
    const previous = get().projects.find((project) => project.id === id);
    if (!previous) return;
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, ...fields } : project,
      ),
    }));
    try {
      await bxUpdateProject(id, fields);
      await get().loadProjects(true);
    } catch (error) {
      set((state) => ({
        projects: state.projects.map((project) => (project.id === id ? previous : project)),
      }));
      throw error;
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
    set({ isLoadingAllTasks: true });
    try {
      // Один server-side endpoint: сервер сначала читает MongoDB, для
      // отсутствующих проектов параллельно фетчит из Битрикса, пишет обратно.
      // На прогретом кэше — мгновенный read без обращения к Битриксу.
      const res = await fetch('/api/tasks/all', {
        headers: getMemberIdHeader(),
      });
      if (!res.ok) throw new Error(`tasks/all HTTP ${res.status}`);
      const data = await res.json();
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      const mapped = tasks.map(convertBxTask);
      set({ allTasks: mapped, isLoadingAllTasks: false });
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

  loadTaskById: async (taskId) => {
    try {
      const task = convertBxTask(await fetchTaskById(taskId));
      set((state) => ({
        tasks: state.tasks.some((item) => item.id === taskId)
          ? state.tasks
          : [...state.tasks, task],
        allTasks: state.allTasks.some((item) => item.id === taskId)
          ? state.allTasks
          : [...state.allTasks, task],
      }));
      return task;
    } catch {
      return null;
    }
  },

  loadTaskDetails: async (taskId: string) => {
    set({ isLoadingTask: true });

    // Независимые REST-вызовы запускаем вместе: журнал времени не должен
    // ждать медленную загрузку комментариев из чата Bitrix24.
    const task =
      get().tasks.find((item) => item.id === taskId) ||
      get().allTasks.find((item) => item.id === taskId);
    const commentsPromise = fetchTaskComments(taskId, task?.chatId);
    const detailsPromise = Promise.all([fetchTaskTimeLog(taskId), fetchSubtasks(taskId)]);

    void detailsPromise
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
          allTasks: state.allTasks.map((t) =>
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

    try {
      const comments = await commentsPromise;
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                comments: comments.map((comment) => ({
                  ...comment,
                  taskId,
                  authorName:
                    comment.authorName ||
                    state.users.find((user) => user.id === comment.authorId)?.name ||
                    'Пользователь',
                })),
              }
            : t,
        ),
        allTasks: state.allTasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                comments: comments.map((comment) => ({
                  ...comment,
                  taskId,
                  authorName:
                    comment.authorName ||
                    state.users.find((user) => user.id === comment.authorId)?.name ||
                    'Пользователь',
                })),
              }
            : t,
        ),
        isLoadingTask: false,
      }));
      void fetchChecklist(taskId)
        .then((checklist) =>
          set((state) => ({
            tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, checklist } : task)),
            allTasks: state.allTasks.map((task) =>
              task.id === taskId ? { ...task, checklist } : task,
            ),
          })),
        )
        .catch(() => {});
    } catch {
      set({ isLoadingTask: false });
    }
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
    const { tasks, allTasks, users } = get();
    const previous =
      tasks.find((task) => task.id === id) || allTasks.find((task) => task.id === id);
    if (!previous) return;

    if (['assigneeId', 'accompliceIds', 'auditorIds'].includes(field)) {
      const members = await fetchProjectMembers(previous.projectId);
      const memberIds = new Set(
        (Array.isArray(members) ? members : []).map((member: any) => String(member.USER_ID)),
      );
      const requested = field === 'assigneeId' ? (value ? [value] : []) : value;
      if (requested.some((id: string) => !memberIds.has(String(id))))
        throw new Error('Можно назначать только участников проекта');
    }

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
    else if (field === 'accompliceIds') update.accompliceIds = value;
    else if (field === 'auditorIds') update.auditorIds = value;
    else if (field === 'projectId') {
      update.projectId = value;
    }

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...update, updatedDate: new Date().toISOString() } : t,
      ),
      allTasks: state.allTasks.map((t) =>
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
    else if (field === 'accompliceIds') bxFields.accompliceIds = value;
    else if (field === 'auditorIds') bxFields.auditorIds = value;
    else if (field === 'projectId') bxFields.groupId = value;

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
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? previous : task)),
        allTasks: state.allTasks.map((task) => (task.id === id ? previous : task)),
      }));
      throw error;
    }
  },

  moveTask: (taskId, newStatus) => {
    get().updateTaskField(taskId, 'status', newStatus);
  },

  moveTaskToProject: async (taskId, projectId) => {
    const { tasks, allTasks, selectedProjectId } = get();
    const previous =
      tasks.find((task) => task.id === taskId) || allTasks.find((task) => task.id === taskId);
    if (!previous || previous.projectId === projectId) return;
    const stages = await fetchProjectStages(projectId);
    const stageId = stages.find((stage) => stage.systemType === 'NEW')?.id || stages[0]?.id;
    if (!stageId) throw new Error('В проекте нет этапов для переноса задачи');

    set((state) => ({
      tasks:
        selectedProjectId === previous.projectId
          ? state.tasks.filter((task) => task.id !== taskId)
          : state.tasks.map((task) =>
              task.id === taskId ? { ...task, projectId, stageId } : task,
            ),
      allTasks: state.allTasks.map((task) =>
        task.id === taskId ? { ...task, projectId, stageId } : task,
      ),
    }));
    try {
      await bxUpdateTaskFull(taskId, { groupId: projectId, stageId });
    } catch (error) {
      set((state) => ({
        tasks:
          selectedProjectId === previous.projectId
            ? [...state.tasks, previous]
            : state.tasks.map((task) => (task.id === taskId ? previous : task)),
        allTasks: state.allTasks.map((task) => (task.id === taskId ? previous : task)),
      }));
      throw error;
    }
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

  addChecklistItem: async (taskId, title, parentId) => {
    await bxAddChecklistItem(taskId, title, parentId);
    const checklist = await fetchChecklist(taskId);
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, checklist } : task)),
    }));
  },

  updateChecklistItem: async (taskId, itemId, title) => {
    await bxUpdateChecklistItem(taskId, itemId, title);
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              checklist: task.checklist?.map((item) =>
                item.id === itemId ? { ...item, title } : item,
              ),
            }
          : task,
      ),
    }));
  },

  setChecklistItemCompleted: async (taskId, itemId, completed) => {
    await bxSetChecklistItemCompleted(taskId, itemId, completed);
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              checklist: task.checklist?.map((item) =>
                item.id === itemId ? { ...item, completed } : item,
              ),
            }
          : task,
      ),
    }));
  },

  deleteChecklistItem: async (taskId, itemId) => {
    await bxDeleteChecklistItem(taskId, itemId);
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, checklist: task.checklist?.filter((item) => item.id !== itemId) }
          : task,
      ),
    }));
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
      set({
        projects: data.projects || [],
        users: data.users || [],
        currentUser: data.currentUser || get().currentUser,
        stages: data.stages ? (Object.values(data.stages).flat() as any[]) : [],
        // Route navigation may select a project before the layout effect restores
        // warm cache. Never let an old cache clear the active route selection.
        selectedProjectId: get().selectedProjectId || data.selectedProjectId || null,
        isRehydrated: true,
      });
    } catch {
      set({ isRehydrated: true });
    }
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
      if (
        filters.search &&
        !`${t.title} ${t.description} ${t.id}`
          .toLocaleLowerCase('ru')
          .includes(filters.search.toLocaleLowerCase('ru'))
      )
        return false;
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
    const { allTasks, currentUser } = get();
    return allTasks.filter((task) => String(task.assigneeId) === String(currentUser.id));
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
      overdue: all.filter((t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now)
        .length,
      in_progress: all.filter((t) => t.status === 'in_progress').length,
      done: all.filter((t) => t.status === 'done').length,
    };
  },
}));

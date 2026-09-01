export interface BxTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  createdDate: string;
  updatedDate: string;
  dueDate?: string;
  estimate: number;
  actualTime: number;
  storyPoints?: number;
  comments: BxComment[];
  commentsCount?: number;
  checklist?: BxChecklistItem[];
  timeEntries: TimeEntry[];
  parentId?: string;
  subtasks: BxTask[];
  stageId: string;
  chatId?: string;
  accompliceIds?: string[];
  auditorIds?: string[];
  tags?: string[];
}

export type TaskStatus = 'new' | 'in_progress' | 'testing' | 'done' | string;

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface BxChecklistItem {
  id: string;
  parentId: string;
  title: string;
  completed: boolean;
}

export interface BxComment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  isSystem?: boolean;
  text: string;
  createdDate: string;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  date: string;
  hours: number;
  description: string;
}

export interface BxUser {
  id: string;
  name: string;
  email?: string;
  icon?: string;
}

export interface BxStage {
  id: string;
  name: string;
  color: string;
  sort: number;
  systemType: string;
}

export const PRIORITY_LABELS: Record<
  TaskPriority,
  { label: string; color: string; bgColor: string }
> = {
  low: {
    label: 'Низкий',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
  medium: {
    label: 'Обычный',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-500/15',
  },
  high: {
    label: 'Высокий',
    color: 'text-orange-700 dark:text-orange-300',
    bgColor: 'bg-orange-500/15',
  },
  critical: {
    label: 'Критический',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-500/15',
  },
};

export const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  testing: 'Тестирование',
  done: 'Готово',
  deferred: 'Отложена',
};

export interface Bx24Project {
  id: string;
  name: string;
  description: string;
  membersCount: number;
  image?: string;
  isArchived?: boolean;
}

export interface Bx24User {
  id: string;
  name: string;
  email?: string;
  icon?: string;
  userType?: 'employee' | 'extranet' | 'email' | string;
}

export interface TaskFilters {
  search: string;
  assigneeId: string;
  priority: string;
  status: string;
  hasDeadline: boolean;
  overdue: boolean;
  showCompleted: boolean;
}

export interface DashboardStats {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  totalEstimate: number;
  totalActual: number;
}

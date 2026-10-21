export interface BxTask {
  id: string;
  /** Ключ группы при серверной группировке грида. */
  groupKey?: string;
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
  results?: BxTaskResult[];
  checklist?: BxChecklistItem[];
  timeEntries: TimeEntry[];
  parentId?: string;
  subtasks: BxTask[];
  stageId: string;
  chatId?: string;
  // Файлы, прикреплённые к описанию задачи (UF_TASK_WEBDAV_FILES).
  attachments?: BxFile[];
  accompliceIds?: string[];
  auditorIds?: string[];
  tags?: string[];
  actions?: Record<string, boolean>;
}

export type TaskStatus = 'new' | 'in_progress' | 'testing' | 'done' | string;

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface BxChecklistItem {
  id: string;
  parentId: string;
  title: string;
  completed: boolean;
}

export interface BxFile {
  id: string;
  name: string;
  size: number;
  // 'image' | 'video' | 'audio' | 'file' — как отдаёт im.dialog.messages.get
  type: string;
  extension: string;
  width?: number;
  height?: number;
}

export interface BxTaskResult {
  id: string;
  taskId: string;
  authorId: string;
  authorName?: string;
  text: string;
  createdAt: string;
}

export interface BxComment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  isSystem?: boolean;
  text: string;
  createdDate: string;
  files?: BxFile[];
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

// Приоритет — состояние, а не украшение: в наборе @monos/ui цвет означает
// сигнал, поэтому высокий и критический тянут на тёплые роли, а обычный
// остаётся тихим.
export const PRIORITY_LABELS: Record<
  TaskPriority,
  { label: string; color: string; bgColor: string }
> = {
  low: {
    label: 'Низкий',
    color: 'text-ink-faint',
    bgColor: 'bg-surface-2',
  },
  medium: {
    label: 'Обычный',
    color: 'text-ink-soft',
    bgColor: 'bg-surface-2',
  },
  high: {
    label: 'Высокий',
    color: 'text-warning-text',
    bgColor: 'bg-warning/10',
  },
  critical: {
    label: 'Критический',
    color: 'text-danger-text',
    bgColor: 'bg-danger/10',
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
  tag: string;
  priority: string;
  status: string;
  hasDeadline: boolean;
  overdue: boolean;
  showCompleted: boolean;
}

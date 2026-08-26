export interface BxTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  assigneeName?: string;
  createdDate: string;
  updatedDate: string;
  dueDate?: string;
  estimate: number;
  actualTime: number;
  storyPoints?: number;
  comments: BxComment[];
  timeEntries: TimeEntry[];
  parentId?: string;
  subtasks: BxTask[];
  stageId: string;
}

export type TaskStatus = 'new' | 'in_progress' | 'testing' | 'done' | string;

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface BxComment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
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
  low: { label: 'Low', color: 'text-gray-500', bgColor: 'bg-gray-100' },
  medium: { label: 'Medium', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  high: { label: 'High', color: 'text-orange-600', bgColor: 'bg-orange-100' },
  critical: { label: 'Critical', color: 'text-red-600', bgColor: 'bg-red-100' },
};

export interface Bx24Project {
  id: string;
  name: string;
  description: string;
  membersCount: number;
  image?: string;
}

export interface Bx24User {
  id: string;
  name: string;
  email?: string;
  icon?: string;
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

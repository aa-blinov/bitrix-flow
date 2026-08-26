// Persistent store для projects, users и задач через localStorage.
// Стратегия stale-while-revalidate: на старте мгновенно показываем то,
// что было в кэше (счётчики не мигают «0»); в фоне догружаем свежее из API.
const STORAGE_KEY = 'bitrix-kanban-cache';
const ALL_TASKS_TTL_MS = 10 * 60 * 1000; // 10 минут — после этого кэш считаем устаревшим

interface CacheData {
  projects?: any[];
  users?: any[];
  currentUser?: { id: string; name: string; photo?: string };
  stages?: Record<string, any[]>;
  selectedProjectId?: string;
  // Кэш задач по всем доступным проектам — для мгновенного отображения
  // счётчиков и /all-tasks после F5.
  allTasks?: any[];
  allTasksCachedAt?: number;
}

export function loadFromStorage(): CacheData {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data || {};
  } catch {
    return {};
  }
}

export function saveToStorage(data: CacheData) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function clearStorage() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

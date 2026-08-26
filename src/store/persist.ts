// Persistent store для projects и users через localStorage.
// Задачи НЕ кэшируем здесь — для них есть серверный кэш в MongoDB
// (см. tasksCacheGet/Set в src/lib/mongo.ts), который живёт дольше и
// разделяется между всеми клиентами одного портала.
const STORAGE_KEY = 'bitrix-kanban-cache';

interface CacheData {
  projects?: any[];
  users?: any[];
  currentUser?: { id: string; name: string; photo?: string };
  stages?: Record<string, any[]>;
  selectedProjectId?: string;
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

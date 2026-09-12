import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Палитра цветов для иконок проектов. Используем opacity-варианты (bg-X-500/20)
// — одинаково читаются в светлой и тёмной теме. Текст — dark: вариант.
const PROJECT_COLORS: readonly string[] = [
  'bg-blue-500/20 text-blue-800 dark:text-blue-300',
  'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300',
  'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  'bg-rose-500/20 text-rose-800 dark:text-rose-300',
  'bg-violet-500/20 text-violet-800 dark:text-violet-300',
  'bg-cyan-500/20 text-cyan-800 dark:text-cyan-300',
  'bg-fuchsia-500/20 text-fuchsia-800 dark:text-fuchsia-300',
  'bg-orange-500/20 text-orange-800 dark:text-orange-300',
  'bg-teal-500/20 text-teal-800 dark:text-teal-300',
  'bg-indigo-500/20 text-indigo-800 dark:text-indigo-300',
];

// Детерминированный хеш имени проекта → индекс в палитре. Один проект
// всегда получает один и тот же цвет, пока существует палитра.
export function hashProjectName(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = (h * 33) ^ name.charCodeAt(i);
  }
  return Math.abs(h | 0);
}

export function getProjectColor(name: string): string {
  return PROJECT_COLORS[hashProjectName(name) % PROJECT_COLORS.length];
}

export function getBitrixTaskUrl(taskId: string): string {
  return `https://eora.bitrix24.ru/company/personal/user/0/tasks/task/view/${encodeURIComponent(taskId)}/`;
}

export function getBitrixUserUrl(userId: string): string {
  return `https://eora.bitrix24.ru/company/personal/user/${encodeURIComponent(userId)}/`;
}

export function getProjectInitials(name: string): string {
  return (name.match(/\p{L}+/gu) ?? [])
    .map((word) => word[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

// Битрикс отдаёт для пользователей без фото относительный путь
// /bitrix/images/tasks/default_avatar.png — браузер просит его с нашего домена
// и получает 404. Берём только абсолютные адреса реальных фото.
export function usableAvatar(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  if (!/^https?:\/\//i.test(url)) return undefined;
  if (/default_avatar/i.test(url)) return undefined;
  return url;
}

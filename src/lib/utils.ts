import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getLocale, t } from './i18n';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Проект помечается инициалами на приподнятой поверхности, а не цветом:
// в наборе @monos/ui цвет означает состояние, и радуга оттенков просто
// съедала бы внимание у сигналов — «просрочено» и «в работе».

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

const RU_PLURAL = new Intl.PluralRules('ru');

// «1 задача, 3 задачи, 5 задач»: forms — [one, few, many].
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  // Формы передаются русскими, перевод берётся у выбранной: в английском их две
  // (один или много), и правила русского склонения к нему не подходят.
  if (getLocale() === 'en') return t(count === 1 ? forms[0] : forms[2]);
  const rule = RU_PLURAL.select(count);
  return rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2];
}

// Значение для <input type="datetime-local"> / "date" в поясе браузера.
// Битрикс отдаёт время в поясе портала (+05:00), и срез строки показывал его
// как местное: дедлайн 16:00 по Москве в поле выглядел как 18:00.
export function toLocalInputValue(value: string | undefined, kind: 'datetime' | 'date'): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return kind === 'date' ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

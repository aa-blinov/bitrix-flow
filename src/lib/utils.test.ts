import { describe, expect, it } from 'vitest';
import { getProjectInitials, pluralRu, toLocalInputValue, usableAvatar } from './utils';

describe('getProjectInitials', () => {
  it('uses only words made of letters', () => {
    expect(getProjectInitials('123 — Авандок LLM / MVP')).toBe('АL');
    expect(getProjectInitials('2026 !!!')).toBe('');
  });
});

describe('usableAvatar', () => {
  it('drops relative paths and the Bitrix placeholder', () => {
    expect(usableAvatar('/bitrix/images/tasks/default_avatar.png')).toBeUndefined();
    expect(usableAvatar('https://portal/bitrix/images/tasks/default_avatar.png')).toBeUndefined();
    expect(usableAvatar('https://portal/upload/photo.jpg')).toBe('https://portal/upload/photo.jpg');
    expect(usableAvatar(undefined)).toBeUndefined();
  });
});

describe('pluralRu', () => {
  const forms = ['задача', 'задачи', 'задач'] as const;
  it('склоняет по правилам русского', () => {
    expect([1, 2, 5, 11, 21, 22, 0].map((n) => pluralRu(n, forms))).toEqual([
      'задача',
      'задачи',
      'задач',
      'задач',
      'задача',
      'задачи',
      'задач',
    ]);
  });
});

describe('toLocalInputValue', () => {
  it('переводит время портала в пояс браузера', () => {
    // Пояс фиксируем: результат зависит от него, а CI и ноутбук живут в разных.
    process.env.TZ = 'UTC';
    expect(toLocalInputValue('2026-09-28T18:00:00+05:00', 'datetime')).toBe('2026-09-28T13:00');
    expect(toLocalInputValue('2026-09-29T02:30:00+05:00', 'date')).toBe('2026-09-28');
    expect(toLocalInputValue('', 'date')).toBe('');
    expect(toLocalInputValue('не дата', 'datetime')).toBe('');
  });
});

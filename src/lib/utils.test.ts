import { describe, expect, it } from 'vitest';
import { getProjectInitials, usableAvatar } from './utils';

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

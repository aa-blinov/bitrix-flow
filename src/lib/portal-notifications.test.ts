import { describe, expect, it } from 'vitest';
import { normalizePortalNotifications } from './portal-notifications';

describe('normalizePortalNotifications', () => {
  it('разбирает кнопки подтверждения, автора и прочитанность', () => {
    const { items, unread } = normalizePortalNotifications({
      total_unread_count: 2,
      users: [{ id: 297, name: 'Екатерина', avatar: 'https://cdn/a.png' }],
      notifications: [
        {
          id: 317177,
          notify_type: 1,
          notify_module: 'calendar',
          author_id: 297,
          notify_title: 'Приглашение на встречу',
          text: 'Приглашаю',
          notify_read: 'N',
          notify_buttons: JSON.stringify([
            { COMMAND: 'notifyConfirm', COMMAND_PARAMS: '317177|Y', TEXT: 'Подтвердить участие' },
            { COMMAND: 'notifyConfirm', COMMAND_PARAMS: '317177|N', TEXT: 'Отказаться' },
            { COMMAND: 'other', COMMAND_PARAMS: '1|Y', TEXT: 'Чужая команда' },
          ]),
        },
        { id: 2, notify_type: 2, notify_module: 'im', author_id: 297, notify_read: 'Y' },
        { id: 3, notify_type: 2, notify_module: 'tasks', author_id: 297, notify_buttons: '{' },
      ],
    });
    expect(unread).toBe(2);
    expect(items[0].buttons).toEqual([
      { text: 'Подтвердить участие', value: 'Y' },
      { text: 'Отказаться', value: 'N' },
    ]);
    expect(items[0].read).toBe(false);
    expect(items[0].author).toEqual({ id: 297, name: 'Екатерина', avatar: 'https://cdn/a.png' });
    expect(items[1].canAnswer).toBe(true);
    // Сломанная строка кнопок не роняет разбор, а уведомление задачи не предлагает ответ.
    expect(items[2].buttons).toEqual([]);
    expect(items[2].canAnswer).toBe(false);
  });

  it('пустой ответ портала это пустой список', () => {
    expect(normalizePortalNotifications(null)).toEqual({ items: [], unread: 0 });
  });
});

// Уведомления портала (колокольчик Битрикса) из im.notify.get: приглашения на встречи,
// напоминания, назначения в задачах, почта. Здесь только разбор ответа, без запросов.

export type PortalNotificationButton = { text: string; value: string };

export type PortalNotification = {
  id: number;
  /** 1 подтверждение с кнопками, 2 от пользователя, 4 системное (коды портала). */
  type: number;
  module: string;
  title: string;
  text: string;
  date: string;
  read: boolean;
  author?: { id: number; name: string; avatar?: string };
  buttons: PortalNotificationButton[];
  /** Быстрый ответ портал принимает на уведомления от людей. */
  canAnswer: boolean;
};

// Кнопки приходят строкой JSON. Подтверждение это команда notifyConfirm с параметрами
// «номер|значение», значение уходит в im.notify.confirm. Чужие команды не показываем:
// нажать их через REST от имени человека нельзя.
function buttonsOf(raw: unknown, id: number): PortalNotificationButton[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((button) => {
      const [forId, value] = String(button?.COMMAND_PARAMS || '').split('|');
      return button?.COMMAND === 'notifyConfirm' && Number(forId) === id && value
        ? { text: String(button.TEXT || value), value }
        : null;
    })
    .filter((button): button is PortalNotificationButton => button !== null);
}

export function normalizePortalNotifications(result: unknown): {
  items: PortalNotification[];
  unread: number;
} {
  const data = (result || {}) as {
    notifications?: Record<string, unknown>[];
    users?: Record<string, unknown>[];
    total_unread_count?: unknown;
  };
  const people = new Map(
    (Array.isArray(data.users) ? data.users : []).map((user) => [Number(user.id), user]),
  );
  const items = (Array.isArray(data.notifications) ? data.notifications : [])
    .filter((item) => Number(item.id) > 0)
    .map((item): PortalNotification => {
      const id = Number(item.id);
      const type = Number(item.notify_type) || 0;
      const authorId = Number(item.author_id) || 0;
      const person = people.get(authorId);
      const avatar = String(person?.avatar || '');
      return {
        id,
        type,
        module: String(item.notify_module || ''),
        title: String(item.notify_title || ''),
        text: String(item.text || ''),
        date: String(item.date || ''),
        read: item.notify_read === 'Y',
        author: person
          ? {
              id: authorId,
              name: String(person.name || ''),
              avatar: /^https:\/\//.test(avatar) ? avatar : undefined,
            }
          : undefined,
        buttons: buttonsOf(item.notify_buttons, id),
        canAnswer: type === 2 && authorId > 0 && item.notify_module === 'im',
      };
    });
  return { items, unread: Number(data.total_unread_count) || 0 };
}

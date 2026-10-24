import { describe, expect, it } from 'vitest';
import {
  DIALOG_ID,
  mergeDialogs,
  mergeMessages,
  normalizeDialogs,
  normalizeMessages,
} from './messenger';

describe('messenger', () => {
  it('accepts only person ids and chat ids as DIALOG_ID', () => {
    expect(['83', 'chat573'].every((id) => DIALOG_ID.test(id))).toBe(true);
    expect(
      ['', 'user83', 'chat', '0', 'sg5', '83/../1', 'chat5 '].some((id) => DIALOG_ID.test(id)),
    ).toBe(false);
  });

  it('splits dialogs into people, groups, tasks and other chats, newest first', () => {
    const dialogs = normalizeDialogs({
      items: [
        {
          id: '83',
          type: 'user',
          title: 'Анна',
          counter: 0,
          date_last_activity: '2026-10-23T10:00:00+03:00',
          user: {},
        },
        {
          id: 'chat5',
          type: 'chat',
          title: 'Проект',
          counter: 3,
          date_last_activity: '2026-10-24T10:00:00+03:00',
          chat: { entity_type: 'SONET_GROUP', entity_id: '7' },
        },
        {
          id: 'chat6',
          type: 'chat',
          title: 'Задача',
          unread: true,
          date_last_activity: '2026-10-22T10:00:00+03:00',
          chat: { entity_type: 'TASKS_TASK', entity_id: '9' },
        },
        {
          id: 'chat7',
          type: 'chat',
          title: 'Общий',
          date_last_activity: '2026-10-21T10:00:00+03:00',
          chat: {},
        },
        { id: 'x', type: 'notify', title: 'Уведомления' },
      ],
    });
    expect(dialogs.map((d) => [d.id, d.kind, d.unread])).toEqual([
      ['chat5', 'group', 3],
      ['83', 'user', 0],
      ['chat6', 'task', 1],
      ['chat7', 'chat', 0],
    ]);
  });

  it('orders messages oldest first and drops non-https avatars', () => {
    const { messages, people } = normalizeMessages({
      messages: [
        { id: 2, author_id: 9, text: 'b', date: 'd2' },
        { id: 1, author_id: 83, text: 'a', date: 'd1' },
      ],
      users: [{ id: 83, name: 'Анна', avatar: 'javascript:alert(1)' }],
    });
    expect(messages.map((m) => m.id)).toEqual([1, 2]);
    expect(people['83'].avatar).toBeUndefined();
  });

  it('merges overlapping pages without duplicates and keeps order', () => {
    const msg = (id: number) => ({ id, authorId: 1, text: String(id), date: '' });
    expect(
      mergeMessages([msg(3), msg(4)], [msg(1), msg(2), msg(3), msg(5)]).map((m) => m.id),
    ).toEqual([1, 2, 3, 4, 5]);

    const dialog = (id: string, date: string, unread = 0) => ({
      id,
      kind: 'chat' as const,
      title: id,
      unread,
      date,
    });
    const merged = mergeDialogs(
      [dialog('a', '2026-10-01T00:00:00Z', 5), dialog('b', '2026-10-02T00:00:00Z')],
      [dialog('a', '2026-10-03T00:00:00Z', 0), dialog('c', '2026-09-01T00:00:00Z')],
    );
    expect(merged.map((d) => [d.id, d.unread])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ]);
  });
});

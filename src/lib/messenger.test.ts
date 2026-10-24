import { describe, expect, it } from 'vitest';
import {
  DIALOG_ID,
  mergeDialogs,
  mergeMessages,
  isOnline,
  normalizeDialogs,
  normalizeMessages,
  normalizeReaders,
  readersOf,
  VOICE_NAME,
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
    const msg = (id: number) => ({
      id,
      authorId: 1,
      text: String(id),
      date: '',
      edited: false,
      likes: [],
      files: [],
      attach: [],
    });
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

  it('attaches files and cards to messages, params may be an empty array', () => {
    const { messages } = normalizeMessages({
      messages: [
        { id: 3, author_id: 9, text: '', date: 'd', params: { FILE_ID: [10, 11, 12] } },
        { id: 2, author_id: 9, text: 'x', date: 'd', params: [] },
        {
          id: 1,
          author_id: 0,
          text: 'y',
          date: 'd',
          params: {
            IS_EDITED: 'Y',
            ATTACH: [
              { BLOCKS: [{ MESSAGE: 'сервис упал' }, { GRID: [{ NAME: 'Хост', VALUE: 'a' }] }] },
            ],
          },
        },
      ],
      files: [
        { id: 10, name: 'a.png', type: 'image', size: 5 },
        { id: 11, name: `${VOICE_NAME} 01.webm`, type: 'video', size: 5 },
        { id: 12, name: 'r.pdf', type: 'file', size: 5, isVoiceNote: false },
      ],
    });
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(messages[2].files.map((f) => f.kind)).toEqual(['image', 'audio', 'file']);
    expect(messages[1].files).toEqual([]);
    expect(messages[0].edited).toBe(true);
    expect(messages[0].attach[0].blocks.map((b) => b.type)).toEqual(['text', 'grid']);
  });

  it('counts a message as read by those whose last read id is not older', () => {
    const readers = normalizeReaders(
      {
        readed_list: [
          { user_id: 9, user_name: 'Я', message_id: 100 },
          { user_id: 2, user_name: 'Анна', message_id: 50 },
          { user_id: 3, user_name: 'Иван', message_id: 0 },
        ],
      },
      9,
    );
    expect(readers).toEqual([{ id: 2, name: 'Анна', messageId: 50 }]);
    const message = (id: number) => ({
      id,
      authorId: 9,
      text: '',
      date: '',
      edited: false,
      likes: [],
      files: [],
      attach: [],
    });
    expect(readersOf(message(50), readers)).toHaveLength(1);
    expect(readersOf(message(51), readers)).toHaveLength(0);
  });

  it('shows a plain preview of a markup message in the dialog list', () => {
    const [dialog] = normalizeDialogs({
      items: [
        {
          id: '83',
          type: 'user',
          user: { name: 'Анна' },
          message: { id: 1, text: '[B]Релиз[/B] **завтра** [USER=2 REPLACE]Дима[/USER]' },
        },
      ],
    });
    expect(dialog.lastMessage?.text).toBe('Релиз завтра Дима');
  });

  it('counts a person as online only with fresh activity, not by the chosen status alone', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const base = { status: 'online', idle: false, absent: false };
    expect(isOnline({ ...base, last_activity_date: '2026-10-24T11:58:00Z' }, now)).toBe(true);
    expect(isOnline({ ...base, last_activity_date: '2026-10-24T07:00:00Z' }, now)).toBe(false);
    expect(
      isOnline(
        {
          ...base,
          last_activity_date: '2026-10-23T00:00:00Z',
          mobile_last_date: '2026-10-24T11:59:00Z',
        },
        now,
      ),
    ).toBe(true);
    expect(isOnline({ ...base, idle: true, last_activity_date: '2026-10-24T11:59:00Z' }, now)).toBe(
      false,
    );
    expect(isOnline({ status: 'dnd', last_activity_date: '2026-10-24T11:59:00Z' }, now)).toBe(
      false,
    );
  });
});

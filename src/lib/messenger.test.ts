import { describe, expect, it } from 'vitest';
import {
  applyMentions,
  DIALOG_ID,
  mergeDialogs,
  mergeMessages,
  portalErrorHint,
  presenceOf,
  presenceText,
  quoteBlock,
  normalizeDialogs,
  normalizeMessages,
  normalizeReaders,
  readersOf,
  VOICE_NAME,
} from './messenger';
import { bitrixPlainText } from './bitrix-markup';
import { parseMessageNodes } from './message-markdown';

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
    // Последняя страница целиком: удалённое на портале 4 пропадает, история до 3 цела.
    expect(
      mergeMessages([msg(1), msg(2), msg(3), msg(4), msg(5)], [msg(3), msg(5)], true).map(
        (m) => m.id,
      ),
    ).toEqual([1, 2, 3, 5]);
    // Пустая последняя страница: последнее сообщение удалили, история пуста.
    expect(mergeMessages([msg(1)], [], true)).toEqual([]);

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
    // Поздний ответ другой страницы со старой версией диалога её не откатывает.
    expect(
      mergeDialogs(merged, [dialog('a', '2026-10-01T00:00:00Z', 5)]).find((d) => d.id === 'a')
        ?.unread,
    ).toBe(0);
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

  it('derives presence from fresh activity, status and away marks, not from status alone', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const base = { status: 'online', idle: false, absent: false };
    const fresh = '2026-10-24T11:58:00Z';
    expect(presenceOf({ ...base, last_activity_date: fresh }, now).state).toBe('online');
    expect(presenceOf({ ...base, last_activity_date: '2026-10-24T07:00:00Z' }, now).state).toBe(
      'offline',
    );
    expect(
      presenceOf(
        {
          ...base,
          last_activity_date: '2026-10-23T00:00:00Z',
          mobile_last_date: '2026-10-24T11:59:00Z',
        },
        now,
      ).state,
    ).toBe('online');
    expect(presenceOf({ ...base, idle: true, last_activity_date: fresh }, now).state).toBe('away');
    expect(presenceOf({ status: 'break', last_activity_date: fresh }, now).state).toBe('away');
    expect(presenceOf({ status: 'dnd', last_activity_date: fresh }, now).state).toBe('busy');
    expect(presenceOf(null, now).state).toBe('offline');
  });

  it('says when a person was last seen, with the right gender', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const seen = (iso: string, gender = 'M') =>
      presenceText(presenceOf({ status: 'online', gender, last_activity_date: iso }, now), now);
    expect(seen('2026-10-24T11:58:00Z')).toBe('в сети');
    expect(seen('2026-10-24T11:48:00Z')).toBe('Был в сети 12 минут назад');
    expect(seen('2026-10-24T09:00:00Z', 'F')).toBe('Была в сети 3 часа назад');
    expect(seen('2026-10-23T08:00:00Z')).toMatch(/^Был в сети вчера в /);
    expect(seen('2026-10-10T08:00:00Z')).toMatch(/^Был в сети 10 окт/);
    expect(presenceText({ state: 'busy' })).toBe('не беспокоить');
    expect(presenceText({ state: 'away', female: true })).toBe('отошла');
  });

  it('names portal failures that have a clear cause and leaves the rest generic', () => {
    expect(portalErrorHint('Исчерпан выделенный дисковый ресурс.<br>')).toMatch(/место на диске/);
    expect(portalErrorHint('expired_token')).toMatch(/истёк/);
    expect(portalErrorHint('что-то непонятное')).toBeNull();
    expect(portalErrorHint(undefined)).toBeNull();
  });

  it('цитата уходит строками >>, их чат Битрикса рисует цитатой, и у нас она читается так же', () => {
    const quote = quoteBlock('Анна', { text: 'первая\nвторая', files: [] });
    expect(quote).toBe('>>Анна: первая вторая\n');
    const nodes = parseMessageNodes(quote + 'ответ');
    expect(nodes[0]).toMatchObject({ type: 'quote' });
    expect(bitrixPlainText(quote, parseMessageNodes)).not.toContain('>');
  });

  it('turns every selected mention into a tag, longer names first', () => {
    expect(
      applyMentions('@Анна и снова @Анна, @Анна Петрова', [
        { id: 1, name: 'Анна' },
        { id: 2, name: 'Анна Петрова' },
      ]),
    ).toBe('[USER=1]Анна[/USER] и снова [USER=1]Анна[/USER], [USER=2]Анна Петрова[/USER]');
    expect(applyMentions('@АннаПетрова, @Анна.', [{ id: 1, name: 'Анна' }])).toBe(
      '@АннаПетрова, [USER=1]Анна[/USER].',
    );
  });
});

describe('quoteBlock', () => {
  it('пересылка несёт текст целиком, каждая строка цитатой; ответ только начало', () => {
    const long = 'а'.repeat(500) + '\nвторая строка';
    const forwarded = quoteBlock('Анна', { text: long, files: [] }, 'Переслано от ', true);
    expect(forwarded).toContain('а'.repeat(500));
    expect(
      forwarded
        .trim()
        .split('\n')
        .every((line) => line.startsWith('>>')),
    ).toBe(true);
    expect(quoteBlock('Анна', { text: long, files: [] }).length).toBeLessThan(330);
    // Нумерация, отступы и код сохраняются, упоминание становится именем.
    const rich = '1. Первый\n    отступ\n[USER=5]Борис[/USER], глянь';
    expect(quoteBlock('Анна', { text: rich, files: [] }, 'Переслано от ', true)).toBe(
      '>>Переслано от Анна: 1. Первый\n>>    отступ\n>>Борис, глянь\n',
    );
  });
});

describe('isTransportFailure', () => {
  it('отличает обрыв связи (исход неизвестен) от отказа портала (точный ответ)', async () => {
    const { isTransportFailure } = await import('./messenger-api');
    expect(isTransportFailure(new Error('BITRIX24_RESPONSE_TIMEOUT'))).toBe(true);
    expect(isTransportFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(
      true,
    );
    expect(isTransportFailure(new Error('Access denied'))).toBe(false);
  });
});

describe('pushEndpointAllowed', () => {
  it('пускает только push-сервисы браузеров, а не внутренние адреса', async () => {
    const { pushEndpointAllowed } = await import('./push');
    expect(pushEndpointAllowed('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(pushEndpointAllowed('https://web.push.apple.com/QW')).toBe(true);
    expect(pushEndpointAllowed('https://wns2-par02p.notify.windows.com/w/?token=1')).toBe(true);
    expect(pushEndpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(pushEndpointAllowed('https://127.0.0.1/hook')).toBe(false);
    expect(pushEndpointAllowed('https://fcm.googleapis.com.evil.io/x')).toBe(false);
    expect(pushEndpointAllowed('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(pushEndpointAllowed('http://fcm.googleapis.com/x')).toBe(false);
  });
});

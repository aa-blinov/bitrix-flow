import { describe, expect, it } from 'vitest';
import { mapEvent } from './messenger-events';

const chat = { id: 351, dialogId: '9', name: 'Мои заметки' };

describe('mapEvent', () => {
  it('maps a new message with a plain preview and the author name', () => {
    const event = mapEvent({
      type: 'ONIMV2MESSAGEADD',
      date: '2026-10-24T21:00:01+03:00',
      data: {
        chat,
        user: { name: 'Анна' },
        message: { id: 5, authorId: 2, text: '[B]Релиз[/B] **завтра**', params: [] },
      },
    });
    expect(event).toMatchObject({
      kind: 'add',
      dialogId: '9',
      chatId: 351,
      messageId: 5,
      authorId: 2,
      author: 'Анна',
      text: 'Релиз завтра',
      muted: false,
    });
  });

  it('reads the bare messageId of a deletion and flags muted chats', () => {
    const event = mapEvent(
      { type: 'ONIMV2MESSAGEDELETE', data: { chat, messageId: 77 } },
      new Set([351]),
    );
    expect(event).toMatchObject({ kind: 'delete', messageId: 77, muted: true });
  });

  it('names a file-only message and skips unknown events', () => {
    expect(
      mapEvent({
        type: 'ONIMV2MESSAGEADD',
        data: { chat, message: { id: 1, text: '', params: { FILE_ID: [3] } } },
      })?.text,
    ).toBe('Файл');
    expect(mapEvent({ type: 'SOMETHING', data: { chat } })).toBeNull();
    expect(mapEvent({ type: 'ONIMV2MESSAGEADD', data: {} })).toBeNull();
  });

  it('flags a mention of me, also in a muted chat, but not of someone else', () => {
    const raw = (text: string) => ({
      type: 'ONIMV2MESSAGEADD',
      data: { chat, user: { name: 'Анна' }, message: { id: 6, authorId: 2, text, params: [] } },
    });
    expect(mapEvent(raw('[USER=9]Саша[/USER] глянь'), new Set([351]), 9)).toMatchObject({
      mentioned: true,
      muted: true,
    });
    expect(mapEvent(raw('[USER=91]Другой[/USER] глянь'), new Set(), 9)?.mentioned).toBe(false);
    expect(mapEvent(raw('[USER=9 REPLACE]Саша[/USER] назначен'), new Set(), 9)?.mentioned).toBe(
      true,
    );
    expect(mapEvent(raw('[USER=9]Саша[/USER]'))?.mentioned).toBe(false);
  });
});

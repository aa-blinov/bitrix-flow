import { describe, expect, it } from 'vitest';
import { mentionsUser, pingText } from './ping';

const labels = { mention: 'Вас упомянули:', message: 'Сообщение' };

describe('pingText', () => {
  it('titles a group ping with the chat and a direct one with the author', () => {
    expect(
      pingText({ chat: 'Team', author: 'Анна', text: 'привет', mentioned: false }, labels),
    ).toEqual({ title: 'Team', body: 'Анна: привет' });
    expect(
      pingText({ chat: 'Анна', author: 'Анна', text: 'привет', mentioned: false }, labels),
    ).toEqual({ title: 'Анна', body: 'привет' });
  });

  it('marks a mention in the body', () => {
    expect(
      pingText({ chat: 'Team', author: 'Анна', text: 'глянь', mentioned: true }, labels).body,
    ).toBe('Вас упомянули: Анна: глянь');
  });
});

describe('mentionsUser', () => {
  it('matches the exact id only', () => {
    expect(mentionsUser('[USER=12]А[/USER]', 12)).toBe(true);
    expect(mentionsUser('[USER=123]А[/USER]', 12)).toBe(false);
    expect(mentionsUser('[USER=12]А[/USER]', 0)).toBe(false);
  });
});

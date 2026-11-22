import { describe, expect, it } from 'vitest';
import { normalizeEvents, normalizePosts, portalDateTime } from './project-life';

describe('project-life', () => {
  it('переводит дату календаря в местное время без пояса', () => {
    expect(portalDateTime('19.01.2026 17:00:00')).toBe('2026-01-19T17:00');
    expect(portalDateTime('19.01.2026')).toBe('2026-01-19T00:00');
    expect(portalDateTime('мусор')).toBe('');
  });
  it('события по времени, без даты отбрасываются', () => {
    const events = normalizeEvents([
      { ID: '2', NAME: 'Б', DATE_FROM: '20.01.2026 10:00:00', DATE_TO: '20.01.2026 11:00:00' },
      { ID: '1', NAME: 'А', DATE_FROM: '19.01.2026 10:00:00', DATE_TO: '19.01.2026 11:00:00' },
      { ID: '3', NAME: 'В', DATE_FROM: '' },
    ]);
    expect(events.map((event) => event.id)).toEqual(['1', '2']);
  });
  it('у микропоста заголовок не дублирует текст', () => {
    const [post] = normalizePosts([
      { ID: '33', TITLE: 'Список задач', DETAIL_TEXT: 'Список задач на неделю', AUTHOR_ID: '11' },
    ]);
    expect(post.title).toBe('');
    const [titled] = normalizePosts([{ ID: '1', TITLE: 'Релиз', DETAIL_TEXT: 'Выкатили v2' }]);
    expect(titled.title).toBe('Релиз');
  });
});

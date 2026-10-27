import { describe, expect, it } from 'vitest';
import { rankTasks, scoreTask } from './task-search';

const task = (id: string, title: string, extra: Partial<Parameters<typeof scoreTask>[0]> = {}) => ({
  id,
  title,
  description: '',
  groupName: '',
  responsibleName: '',
  ...extra,
});

describe('task search ranking', () => {
  it('puts an exact title above a loose mention and drops mid-word description hits', () => {
    const ranked = rankTasks(
      [
        task('1', 'Совещание', { description: 'обсудить capital и api' }),
        task('2', 'Миграция API'),
        task('3', 'API', {}),
        task('4', 'Прочее', { description: 'capital markets' }),
      ],
      'api',
    );
    expect(ranked.map((item) => item.id)).toEqual(['3', '2', '1']);
  });

  it('requires every word and matches the number exactly', () => {
    expect(scoreTask(task('5', 'Релиз банка'), 'релиз казна')).toBe(0);
    expect(scoreTask(task('5', 'Релиз банка'), 'банк релиз')).toBeGreaterThan(0);
    expect(scoreTask(task('5551', 'Другое'), '#5551')).toBe(1000);
    expect(scoreTask(task('55512', 'Другое'), '5551')).toBe(0);
  });

  it('finds by assignee and project at a word start', () => {
    expect(
      scoreTask(task('6', 'Задача', { responsibleName: 'Анна Иванова' }), 'иван'),
    ).toBeGreaterThan(0);
    expect(scoreTask(task('6', 'Задача', { groupName: 'БСПБ | Баги' }), 'баги')).toBeGreaterThan(0);
    expect(scoreTask(task('6', 'Задача', { responsibleName: 'Анна Иванова' }), 'вано')).toBe(0);
  });
});

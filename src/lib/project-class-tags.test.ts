import { describe, expect, it } from 'vitest';

import { planClassTags, type TaskNode } from './project-class-tags';

const node = (id: string, tags: string[] = [], parentId = '', projectId = '10'): TaskNode => ({
  id,
  parentId,
  projectId,
  title: `#${id}`,
  tags,
});

const plan = (tasks: TaskNode[], next = 'commercial' as const, previous = null as any) =>
  Object.fromEntries(planClassTags(tasks, '10', next, previous).map((c) => [c.taskId, c.to]));

describe('раскладка класса проекта тегами на задачи', () => {
  it('задача без тега и без размеченных предков получает тег, остальные теги сохраняются', () => {
    expect(plan([node('1', ['срочно'])])).toEqual({ '1': ['срочно', 'часы-коммерция'] });
  });

  it('ручной тег другого класса и конфликт не трогаются', () => {
    expect(plan([node('1', ['часы-брак']), node('2', ['часы-брак', 'часы-пресейл'])])).toEqual({});
  });

  it('подзадача размеченного родителя следует за родителем, даже если он в другом проекте', () => {
    const tasks = [node('1', ['часы-брак'], '', '20'), node('2', [], '1'), node('3', [], '2')];
    expect(plan(tasks)).toEqual({});
  });

  it('родитель и подзадачи без тегов получают тег все вместе', () => {
    expect(Object.keys(plan([node('1'), node('2', [], '1')]))).toEqual(['1', '2']);
  });

  it('смена класса переносит тег старого класса проекта, ручной другой остаётся', () => {
    const tasks = [node('1', ['часы-пресейл']), node('2', ['часы-брак']), node('3')];
    expect(plan(tasks, 'commercial', 'presale')).toEqual({
      '1': ['часы-коммерция'],
      '3': ['часы-коммерция'],
    });
  });

  it('задачи чужого проекта не попадают в план', () => {
    expect(plan([node('1', [], '', '20')])).toEqual({});
  });
});

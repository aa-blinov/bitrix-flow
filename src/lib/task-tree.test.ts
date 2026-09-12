import { describe, expect, it } from 'vitest';
import { orderTasksAsTree } from './task-tree';

const ids = (tasks: Array<{ id: string }>) => tasks.map((task) => task.id);

describe('orderTasksAsTree', () => {
  it('ставит детей под своим родителем', () => {
    const all = [{ id: '1' }, { id: '2', parentId: '1' }, { id: '3' }, { id: '4', parentId: '2' }];
    expect(ids(orderTasksAsTree(all, all))).toEqual(['1', '2', '4', '3']);
  });

  it('подтягивает родителя, не попавшего в выборку', () => {
    const all = [{ id: '1' }, { id: '2', parentId: '1' }, { id: '3', parentId: '2' }];
    const matching = [all[2]];
    expect(ids(orderTasksAsTree(matching, all))).toEqual(['1', '2', '3']);
  });

  it('не зацикливается на битой ссылке родителя', () => {
    const all = [
      { id: '1', parentId: '2' },
      { id: '2', parentId: '1' },
    ];
    expect(ids(orderTasksAsTree(all, all)).sort()).toEqual(['1', '2']);
  });

  it('держит порядок выборки на одном уровне', () => {
    const all = [{ id: 'b' }, { id: 'a' }, { id: 'c', parentId: 'a' }];
    expect(ids(orderTasksAsTree(all, all))).toEqual(['b', 'a', 'c']);
  });
});

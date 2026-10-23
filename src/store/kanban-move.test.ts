import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// bitrix24.ts работает в «браузерном» режиме (in-memory cache), чтобы не
// тянуть серверный mongo.ts. isClient вычисляется один раз при загрузке
// модуля, поэтому window нужно выставить ДО импорта стора.
vi.hoisted(() => {
  // @ts-expect-error - vitest эмулирует window для cacheGet/cacheSet
  globalThis.window = { location: { search: '' } };
  const mem: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => {
      mem[k] = v;
    },
    removeItem: (k: string) => {
      delete mem[k];
    },
    clear: () => {
      for (const k of Object.keys(mem)) delete mem[k];
    },
    key: (i: number) => Object.keys(mem)[i] ?? null,
    get length() {
      return Object.keys(mem).length;
    },
  } as any;
});

import { useKanbanStore } from './kanban';

describe('перенос задачи в другой проект', () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    useKanbanStore.setState({
      tasks: [{ id: '10', projectId: '1', stageId: '21', title: 'Задача' }] as any,
      allTasks: [],
      selectedProjectId: '1',
    } as any);
    global.fetch = vi.fn(async (url: any, init: any) => {
      const target = String(url || '');
      const body = String(init?.body || '');
      calls.push(`${target} ${body}`);
      if (target.includes('task.stages.get')) {
        return {
          ok: true,
          json: async () => ({ result: [{ id: '5', name: 'Новые', systemType: 'NEW' }] }),
        } as Response;
      }
      if (target.includes('tasks.task.update')) {
        return { ok: true, json: async () => ({ result: { task: { id: '10' } } }) } as Response;
      }
      return { ok: true, json: async () => ({ result: {} }) } as Response;
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('вне проекта стадии не спрашивает и ставит GROUP_ID = 0', async () => {
    await useKanbanStore.getState().moveTaskToProject('10', 'none');

    expect(calls.some((call) => call.includes('task.stages.get'))).toBe(false);
    const update = calls.find((call) => call.includes('tasks.task.update')) || '';
    expect(update).toContain('GROUP_ID');
    expect(update).toContain('STAGE_ID');
    // Задача ушла из текущего проекта — живёт в allTasks.
    expect(useKanbanStore.getState().allTasks[0]?.projectId).toBe('0');
    expect(useKanbanStore.getState().allTasks[0]?.stageId).toBe('0');
  });

  it('в обычный проект берёт фазу «Новые» и переносит задачу', async () => {
    await useKanbanStore.getState().moveTaskToProject('10', '7');

    expect(calls.some((call) => call.includes('task.stages.get'))).toBe(true);
    expect(useKanbanStore.getState().allTasks[0]?.projectId).toBe('7');
    expect(useKanbanStore.getState().allTasks[0]?.stageId).toBe('5');
  });
});
